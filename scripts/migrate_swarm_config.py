#!/usr/bin/env python3
"""Split monolithic swarm-config.json into one file per agent in config/agents/.

The original swarm-config*.json files are left untouched so the existing
coordinator/proxy binaries continue to read them. Phase 5 removes the
originals once all launch paths consume config/agents/.

Usage:
    python scripts/migrate_swarm_config.py [--source swarm-config.json] [--dry-run]
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger("migrate_swarm_config")

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SOURCE = REPO_ROOT / "swarm-config.json"
DEFAULT_OUT_DIR = REPO_ROOT / "config" / "agents"

REQUIRED_FIELDS = {"name", "model", "system_prompt", "context", "max_tokens"}


def slugify(name: str) -> str:
    return name.strip().lower().replace(" ", "-")


def split_agents(source: Path, out_dir: Path, dry_run: bool) -> int:
    try:
        data = json.loads(source.read_text())
    except FileNotFoundError:
        logger.error("source not found: %s", source)
        raise
    except json.JSONDecodeError as exc:
        logger.error("invalid JSON in %s: %s", source, exc)
        raise

    agents = data.get("agents")
    if not isinstance(agents, list) or not agents:
        logger.error("no 'agents' array in %s", source)
        sys.exit(2)

    if not dry_run:
        out_dir.mkdir(parents=True, exist_ok=True)

    seen: set[str] = set()
    written = 0
    for agent in agents:
        missing = REQUIRED_FIELDS - agent.keys()
        if missing:
            logger.error("agent %r missing fields %s", agent.get("name"), missing)
            sys.exit(3)

        name = agent["name"]
        slug = slugify(name)
        if slug in seen:
            logger.error("duplicate agent name after slugify: %s", slug)
            sys.exit(4)
        seen.add(slug)

        out_path = out_dir / f"{slug}.json"
        payload = {"agent_id": slug, **agent}
        text = json.dumps(payload, indent=2, sort_keys=True) + "\n"

        if dry_run:
            logger.info("[dry-run] would write %s (%d bytes)", out_path, len(text))
        else:
            out_path.write_text(text)
            logger.info("wrote %s", out_path)
        written += 1

    logger.info("split %d agents from %s", written, source)
    return written


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    p.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR)
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args()

    n = split_agents(args.source, args.out_dir, args.dry_run)
    if n != 17:
        logger.warning("expected 17 agents per plan, got %d", n)
    return 0


if __name__ == "__main__":
    sys.exit(main())
