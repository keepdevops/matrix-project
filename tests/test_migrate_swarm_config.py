"""Tests for scripts/migrate_swarm_config.py — 0% coverage before this file.

Covers slugify() and split_agents() including validation, error paths,
duplicate detection, dry-run mode, and agent_id injection.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

# Make the scripts directory importable.
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from migrate_swarm_config import slugify, split_agents  # noqa: E402


# ---------------------------------------------------------------------------
# slugify
# ---------------------------------------------------------------------------

def test_slugify_lowercase():
    assert slugify("Architect") == "architect"


def test_slugify_spaces_to_hyphens():
    assert slugify("My Agent") == "my-agent"


def test_slugify_strips_leading_trailing_whitespace():
    assert slugify("  foreman  ") == "foreman"


def test_slugify_already_lowercase_unchanged():
    assert slugify("programmer") == "programmer"


def test_slugify_multiple_words():
    assert slugify("Senior Code Reviewer") == "senior-code-reviewer"


# ---------------------------------------------------------------------------
# split_agents — happy path
# ---------------------------------------------------------------------------

def _write_config(path: Path, agents: list[dict]) -> None:
    path.write_text(json.dumps({"agents": agents}))


def _valid_agent(**overrides) -> dict:
    base = {
        "name": "tester",
        "model": "models/tiny.gguf",
        "system_prompt": "You are a tester.",
        "context": 2048,
        "max_tokens": 256,
    }
    base.update(overrides)
    return base


def test_split_agents_writes_file_per_agent(tmp_path):
    src = tmp_path / "swarm.json"
    out = tmp_path / "agents"
    _write_config(src, [_valid_agent(name="alpha"), _valid_agent(name="beta")])

    n = split_agents(src, out, dry_run=False)

    assert n == 2
    assert (out / "alpha.json").is_file()
    assert (out / "beta.json").is_file()


def test_split_agents_injects_agent_id(tmp_path):
    src = tmp_path / "swarm.json"
    out = tmp_path / "agents"
    _write_config(src, [_valid_agent(name="My Agent")])

    split_agents(src, out, dry_run=False)

    data = json.loads((out / "my-agent.json").read_text())
    assert data["agent_id"] == "my-agent"


def test_split_agents_preserves_all_fields(tmp_path):
    src = tmp_path / "swarm.json"
    out = tmp_path / "agents"
    agent = _valid_agent(name="reviewer", system_prompt="Review code carefully.")
    _write_config(src, [agent])

    split_agents(src, out, dry_run=False)

    data = json.loads((out / "reviewer.json").read_text())
    assert data["system_prompt"] == "Review code carefully."
    assert data["model"] == agent["model"]


def test_split_agents_returns_count(tmp_path):
    src = tmp_path / "swarm.json"
    out = tmp_path / "agents"
    agents = [_valid_agent(name=f"agent-{i}") for i in range(5)]
    _write_config(src, agents)

    assert split_agents(src, out, dry_run=False) == 5


def test_split_agents_output_is_valid_json(tmp_path):
    src = tmp_path / "swarm.json"
    out = tmp_path / "agents"
    _write_config(src, [_valid_agent()])

    split_agents(src, out, dry_run=False)

    for f in out.glob("*.json"):
        json.loads(f.read_text())  # must not raise


def test_split_agents_dry_run_writes_no_files(tmp_path):
    src = tmp_path / "swarm.json"
    out = tmp_path / "agents"
    _write_config(src, [_valid_agent(name="architect")])

    n = split_agents(src, out, dry_run=True)

    assert n == 1
    assert not out.exists()  # directory never created in dry-run


def test_split_agents_creates_out_dir(tmp_path):
    src = tmp_path / "swarm.json"
    out = tmp_path / "deep" / "agents"
    _write_config(src, [_valid_agent()])

    split_agents(src, out, dry_run=False)

    assert out.is_dir()


# ---------------------------------------------------------------------------
# split_agents — error paths
# ---------------------------------------------------------------------------

def test_split_agents_raises_on_missing_source(tmp_path):
    with pytest.raises(FileNotFoundError):
        split_agents(tmp_path / "nonexistent.json", tmp_path / "out", dry_run=False)


def test_split_agents_raises_on_invalid_json(tmp_path):
    src = tmp_path / "bad.json"
    src.write_text("{not valid json")
    with pytest.raises(json.JSONDecodeError):
        split_agents(src, tmp_path / "out", dry_run=False)


def test_split_agents_exits_on_missing_agents_key(tmp_path):
    src = tmp_path / "swarm.json"
    src.write_text(json.dumps({"coordinator": {}}))
    with pytest.raises(SystemExit) as exc_info:
        split_agents(src, tmp_path / "out", dry_run=False)
    assert exc_info.value.code == 2


def test_split_agents_exits_on_empty_agents_list(tmp_path):
    src = tmp_path / "swarm.json"
    src.write_text(json.dumps({"agents": []}))
    with pytest.raises(SystemExit) as exc_info:
        split_agents(src, tmp_path / "out", dry_run=False)
    assert exc_info.value.code == 2


def test_split_agents_exits_on_missing_required_field(tmp_path):
    src = tmp_path / "swarm.json"
    # 'context' is required but absent
    agent = {k: v for k, v in _valid_agent().items() if k != "context"}
    _write_config(src, [agent])
    with pytest.raises(SystemExit) as exc_info:
        split_agents(src, tmp_path / "out", dry_run=False)
    assert exc_info.value.code == 3


def test_split_agents_exits_on_duplicate_name(tmp_path):
    src = tmp_path / "swarm.json"
    _write_config(src, [_valid_agent(name="alpha"), _valid_agent(name="alpha")])
    with pytest.raises(SystemExit) as exc_info:
        split_agents(src, tmp_path / "out", dry_run=False)
    assert exc_info.value.code == 4


def test_split_agents_detects_duplicate_after_slugify(tmp_path):
    # "My Agent" and "my agent" both slugify to "my-agent"
    src = tmp_path / "swarm.json"
    _write_config(src, [_valid_agent(name="My Agent"), _valid_agent(name="my agent")])
    with pytest.raises(SystemExit) as exc_info:
        split_agents(src, tmp_path / "out", dry_run=False)
    assert exc_info.value.code == 4
