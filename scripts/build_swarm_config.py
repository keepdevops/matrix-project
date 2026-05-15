#!/usr/bin/env python3
"""Generate swarm-config.json from config/coordinator.json + config/agents/*.json.

The monolithic swarm-config.json (and its public/ copy) is a build artifact:
edit per-agent files in config/agents/ and re-run this script.
"""
from __future__ import annotations

import json
import logging
import shutil
import sys
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="[build_swarm_config] %(message)s")
log = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parent.parent
AGENTS_DIR = ROOT / "config" / "agents"
COORDINATOR_FILE = ROOT / "config" / "coordinator.json"
OUT_FILE = ROOT / "swarm-config.json"
PUBLIC_OUT = ROOT / "public" / "swarm-config.json"

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


def load_agents() -> list[dict]:
    if not AGENTS_DIR.is_dir():
        log.error("agents directory missing: %s", AGENTS_DIR)
        sys.exit(1)
    agents: list[dict] = []
    for path in sorted(AGENTS_DIR.glob("*.json")):
        data = load_json(path)
        if "name" not in data:
            log.error("%s missing 'name' field", path)
            sys.exit(1)
        cleaned = {k: v for k, v in data.items() if k not in AGENT_INTERNAL_KEYS}
        agents.append(cleaned)
    if not agents:
        log.error("no agent files under %s", AGENTS_DIR)
        sys.exit(1)
    agents.sort(key=lambda a: a["name"])
    return agents


def build() -> dict:
    coord = load_json(COORDINATOR_FILE)
    return {
        "agents": load_agents(),
        "coordinator": coord.get("coordinator", {}),
        "ui": coord.get("ui", {}),
    }


def main() -> int:
    config = build()
    payload = json.dumps(config, indent=2, sort_keys=True) + "\n"
    OUT_FILE.write_text(payload)
    log.info("wrote %s (%d agents)", OUT_FILE.relative_to(ROOT), len(config["agents"]))
    if PUBLIC_OUT.parent.is_dir():
        shutil.copyfile(OUT_FILE, PUBLIC_OUT)
        log.info("copied -> %s", PUBLIC_OUT.relative_to(ROOT))
    return 0


if __name__ == "__main__":
    sys.exit(main())
