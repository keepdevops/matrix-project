"""Tests for scripts/build_swarm_config.py."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "scripts" / "build_swarm_config.py"
AGENTS_DIR = ROOT / "config" / "agents"
COORD_FILE = ROOT / "config" / "coordinator.json"


def run_generator(root: Path) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(SCRIPT), "--root", str(root)],
        capture_output=True,
        text=True,
        check=False,
    )


@pytest.fixture
def staged_repo(tmp_path: Path) -> Path:
    """Copy config/ + scripts/ into tmp_path so the generator runs in isolation."""
    (tmp_path / "config").mkdir()
    (tmp_path / "config" / "agents").mkdir()
    (tmp_path / "scripts").mkdir()
    (tmp_path / "public").mkdir()

    for src in AGENTS_DIR.glob("*.json"):
        (tmp_path / "config" / "agents" / src.name).write_text(src.read_text())
    (tmp_path / "config" / "coordinator.json").write_text(COORD_FILE.read_text())
    (tmp_path / "scripts" / "build_swarm_config.py").write_text(SCRIPT.read_text())
    return tmp_path


def test_generator_produces_expected_structure(staged_repo: Path) -> None:
    result = run_generator(staged_repo)
    assert result.returncode == 0, result.stderr

    out = json.loads((staged_repo / "swarm-config.json").read_text())
    assert set(out.keys()) == {"agents", "coordinator", "ui"}
    assert len(out["agents"]) == len(list(AGENTS_DIR.glob("*.json")))

    # agent_id is an internal per-file key and must be stripped.
    for agent in out["agents"]:
        assert "agent_id" not in agent
        assert "name" in agent

    # public/ copy is byte-identical.
    assert (staged_repo / "public" / "swarm-config.json").read_bytes() == \
        (staged_repo / "swarm-config.json").read_bytes()


def test_generator_output_is_deterministic(staged_repo: Path) -> None:
    assert run_generator(staged_repo).returncode == 0
    first = (staged_repo / "swarm-config.json").read_bytes()
    assert run_generator(staged_repo).returncode == 0
    assert (staged_repo / "swarm-config.json").read_bytes() == first


def test_generator_fails_on_agent_missing_name(staged_repo: Path) -> None:
    bad = staged_repo / "config" / "agents" / "broken.json"
    bad.write_text(json.dumps({"agent_id": "broken", "engine": "llama"}))
    result = run_generator(staged_repo)
    assert result.returncode != 0
    assert "missing 'name'" in result.stderr


def test_generator_fails_when_agents_dir_empty(staged_repo: Path) -> None:
    for f in (staged_repo / "config" / "agents").glob("*.json"):
        f.unlink()
    result = run_generator(staged_repo)
    assert result.returncode != 0
    assert "no agent files" in result.stderr


def test_generator_matches_committed_output() -> None:
    """The committed config/agents/ tree should regenerate without semantic drift."""
    result = run_generator(ROOT)
    assert result.returncode == 0, result.stderr
    out = json.loads((ROOT / "swarm-config.json").read_text())
    names_from_files = sorted(
        json.loads(p.read_text())["name"] for p in AGENTS_DIR.glob("*.json")
    )
    assert sorted(a["name"] for a in out["agents"]) == names_from_files
