"""Tests for scripts/build_swarm_config.py."""
from __future__ import annotations

import json
import os
import platform
import subprocess
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import build_swarm_config  # noqa: E402

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
    assert {"agents", "coordinator", "ui"}.issubset(out.keys())
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


# ---------------------------------------------------------------------------
# Unit tests for pure functions in build_swarm_config
# ---------------------------------------------------------------------------

def test_default_model_dir_darwin():
    with patch("platform.system", return_value="Darwin"):
        result = build_swarm_config._default_model_dir()
    assert result == "/Users/Shared/llama/models"


def test_default_model_dir_linux():
    with patch("platform.system", return_value="Linux"):
        result = build_swarm_config._default_model_dir()
    assert result == ""


def test_load_json_parses_valid_file(tmp_path):
    f = tmp_path / "data.json"
    f.write_text(json.dumps({"key": "value"}))
    assert build_swarm_config.load_json(f) == {"key": "value"}


def test_load_json_raises_on_missing_file(tmp_path):
    with pytest.raises(OSError):
        build_swarm_config.load_json(tmp_path / "nonexistent.json")


def test_load_json_raises_on_invalid_json(tmp_path):
    f = tmp_path / "bad.json"
    f.write_text("{not valid")
    with pytest.raises(json.JSONDecodeError):
        build_swarm_config.load_json(f)


def test_load_agents_exits_on_unresolved_env_var(tmp_path):
    agents_dir = tmp_path / "agents"
    agents_dir.mkdir()
    (agents_dir / "bot.json").write_text(json.dumps({
        "name": "bot",
        "model": "${UNSET_VAR_XYZ}/model.gguf",
        "system_prompt": "you are a bot",
        "context": 2048,
        "max_tokens": 64,
        "engine": "llama",
    }))
    # Ensure the env var is NOT set.
    env = {k: v for k, v in os.environ.items() if k != "UNSET_VAR_XYZ"}
    with patch.dict(os.environ, env, clear=True):
        with pytest.raises(SystemExit):
            build_swarm_config.load_agents(agents_dir)


def test_load_agents_expands_matrix_model_dir(tmp_path):
    agents_dir = tmp_path / "agents"
    agents_dir.mkdir()
    (agents_dir / "coder.json").write_text(json.dumps({
        "name": "coder",
        "model": "${MATRIX_MODEL_DIR}/coder.gguf",
        "system_prompt": "code",
        "context": 2048,
        "max_tokens": 64,
        "engine": "llama",
    }))
    with patch.dict(os.environ, {"MATRIX_MODEL_DIR": "/shared/models"}):
        agents = build_swarm_config.load_agents(agents_dir)
    assert agents[0]["model"] == "/shared/models/coder.gguf"


def test_load_agents_strips_agent_id_key(tmp_path):
    agents_dir = tmp_path / "agents"
    agents_dir.mkdir()
    (agents_dir / "reviewer.json").write_text(json.dumps({
        "agent_id": "reviewer",
        "name": "reviewer",
        "model": "",
        "system_prompt": "review",
        "context": 2048,
        "max_tokens": 64,
        "engine": "llama",
    }))
    agents = build_swarm_config.load_agents(agents_dir)
    assert "agent_id" not in agents[0]


def test_load_agents_sorts_by_name(tmp_path):
    agents_dir = tmp_path / "agents"
    agents_dir.mkdir()
    for name in ["zeta", "alpha", "mango"]:
        (agents_dir / f"{name}.json").write_text(json.dumps({
            "name": name, "model": "", "system_prompt": "x",
            "context": 2048, "max_tokens": 64, "engine": "llama",
        }))
    agents = build_swarm_config.load_agents(agents_dir)
    assert [a["name"] for a in agents] == ["alpha", "mango", "zeta"]
