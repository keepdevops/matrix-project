#!/usr/bin/env python3
"""Generate swarm-config.json from config/coordinator.json + config/agents/*.json.

The monolithic swarm-config.json (and its public/ copy) is a build artifact:
edit per-agent files in config/agents/ and re-run this script.
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import platform
import shutil
import sys
from pathlib import Path


def _default_model_dir() -> str:
    """Fallback for MATRIX_MODEL_DIR, mirroring scripts/matrix-env.sh."""
    if platform.system() == "Darwin":
        return "/Users/Shared/llama/models"
    return ""


os.environ.setdefault("MATRIX_MODEL_DIR", _default_model_dir())

logging.basicConfig(level=logging.INFO, format="[build_swarm_config] %(message)s")
log = logging.getLogger(__name__)

DEFAULT_ROOT = Path(__file__).resolve().parent.parent

# Keys stripped from per-agent files when assembling the monolith.
# (They exist for the per-agent loader, not the flat schema.)
AGENT_INTERNAL_KEYS = {"agent_id"}


def load_json(path: Path) -> dict:
    try:
        with path.open() as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError) as exc:
        log.error("failed to read %s: %s", path, exc)
        raise


def load_agents(agents_dir: Path) -> list[dict]:
    if not agents_dir.is_dir():
        log.error("agents directory missing: %s", agents_dir)
        sys.exit(1)
    agents: list[dict] = []
    for path in sorted(agents_dir.glob("*.json")):
        data = load_json(path)
        if "name" not in data:
            log.error("%s missing 'name' field", path)
            sys.exit(1)
        cleaned = {k: v for k, v in data.items() if k not in AGENT_INTERNAL_KEYS}
        if isinstance(cleaned.get("model"), str):
            expanded = os.path.expandvars(os.path.expanduser(cleaned["model"]))
            if "$" in expanded:
                log.error("%s: unresolved env var in model path: %s", path, cleaned["model"])
                sys.exit(1)
            cleaned["model"] = expanded
        agents.append(cleaned)
    if not agents:
        log.error("no agent files under %s", agents_dir)
        sys.exit(1)
    agents.sort(key=lambda a: a["name"])
    return agents


def build(root: Path) -> dict:
    coord = load_json(root / "config" / "coordinator.json")
    out: dict = {
        "agents": load_agents(root / "config" / "agents"),
        "coordinator": coord.get("coordinator", {}),
        "ui": coord.get("ui", {}),
    }
    if "rag" in coord:
        out["rag"] = coord["rag"]
    return out


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT,
                        help="repo root (default: parent of this script)")
    args = parser.parse_args(argv)
    root = args.root.resolve()

    config = build(root)
    payload = json.dumps(config, indent=2, sort_keys=True) + "\n"
    out_file = root / "swarm-config.json"
    out_file.write_text(payload)
    log.info("wrote %s (%d agents)", out_file.relative_to(root), len(config["agents"]))
    public_out = root / "public" / "swarm-config.json"
    if public_out.parent.is_dir():
        shutil.copyfile(out_file, public_out)
        log.info("copied -> %s", public_out.relative_to(root))
    return 0


if __name__ == "__main__":
    sys.exit(main())
