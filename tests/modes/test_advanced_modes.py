"""Unit tests for map_reduce, speculative, critic_debate, tree_of_thought modes."""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))

from orchestration.manager import AgentConfig  # noqa: E402
from orchestration.modes.base import ModeContext  # noqa: E402
from orchestration.modes.critic_debate import CriticDebateMode  # noqa: E402
from orchestration.modes.map_reduce import MapReduceMode  # noqa: E402
from orchestration.modes.speculative import SpeculativeMode  # noqa: E402
from orchestration.modes.tree_of_thought import TreeOfThoughtMode  # noqa: E402

# Direct dispatch — replaces the removed registry's get_mode(). These four are
# the live advanced modes served by the orchestrate sidecar.
_MODE_CLASSES = {
    "map_reduce": MapReduceMode,
    "critic_debate": CriticDebateMode,
    "speculative": SpeculativeMode,
    "tree_of_thought": TreeOfThoughtMode,
}
from tests.modes.fake_backend import FakeBackend, FailingBackend, ScriptedBackend  # noqa: E402


def _agent(agent_id: str, engine: str = "fake") -> AgentConfig:
    return AgentConfig(
        agent_id=agent_id,
        name=agent_id,
        model="fake",
        system_prompt=f"you are {agent_id}",
        context=2048,
        max_tokens=64,
        engine=engine,
    )


def _ctx(agents: list[str], backends: dict, **params) -> ModeContext:
    swarm = {a: _agent(a, engine=list(backends.keys())[0]) for a in agents}
    for aid in agents:
        swarm[aid] = _agent(aid, engine=list(backends.keys())[0])
    return ModeContext(
        swarm=swarm,
        backends=backends,
        agents=agents,
        params=params,
        request_id="test",
    )


def _collect(mode_id: str, ctx: ModeContext, query: str = "q") -> list:
    cls = _MODE_CLASSES[mode_id]

    async def run():
        return [ev async for ev in cls().execute(ctx, query)]

    return asyncio.run(run())


# ---------------------------------------------------------------------------
# map_reduce
# ---------------------------------------------------------------------------

def test_map_reduce_map_and_synthesize():
    backends = {"fake": ScriptedBackend("map1", "map2", "merged")}
    ctx = _ctx(
        ["worker", "synth"],
        backends,
        chunks=["chunk-a", "chunk-b"],
        synthesizer="synth",
    )
    events = _collect("map_reduce", ctx)
    kinds = [e.kind for e in events]
    assert kinds.count("agent_start") >= 3  # 2 map + 1 reduce
    assert events[-1].kind == "result"
    assert events[-1].meta["synthesizer"] == "synth"
    assert events[-1].meta["n_chunks"] == 2
    assert "merged" in events[-1].text


def test_map_reduce_injects_rag_context():
    backends = {"fake": FakeBackend("x")}
    ctx = _ctx(
        ["worker", "synth"],
        backends,
        chunks=["c1"],
        synthesizer="synth",
        rag_context=[{"source_path": "p.md", "distance": 0.1, "content": "ctx"}],
    )
    events = _collect("map_reduce", ctx)
    assert events[-1].kind == "result"


def test_map_reduce_empty_chunks_raises():
    ctx = _ctx(["a"], {"fake": FakeBackend()})
    with pytest.raises(ValueError, match="chunks"):
        _collect("map_reduce", ctx)


def test_map_reduce_worker_error_emits_error_event():
    backends = {"fail": FailingBackend("worker down"), "fake": FakeBackend("ok")}
    swarm_agents = ["worker", "synth"]
    swarm = {a: _agent(a, "fail" if a == "worker" else "fake") for a in swarm_agents}
    ctx = ModeContext(
        swarm=swarm,
        backends=backends,
        agents=swarm_agents,
        params={"chunks": ["c1"], "synthesizer": "synth"},
        request_id="test",
    )
    events = _collect("map_reduce", ctx)
    assert any(e.kind == "error" and e.agent_id == "worker" for e in events)


# ---------------------------------------------------------------------------
# speculative
# ---------------------------------------------------------------------------

def test_speculative_drafter_verifier_round_trip():
    backends = {
        "fake": ScriptedBackend("draft-block", "draft-block", "x"),
    }
    swarm = {
        "drafter": _agent("drafter"),
        "verifier": _agent("verifier"),
    }
    ctx = ModeContext(
        swarm=swarm,
        backends=backends,
        agents=["drafter", "verifier"],
        params={"drafter": "drafter", "verifier": "verifier", "block_size": 5},
        request_id="test",
    )
    events = _collect("speculative", ctx)
    assert events[-1].kind == "result"
    assert events[-1].meta["mode"] == "speculative"
    assert any(e.kind == "token" and e.agent_id == "verifier" for e in events)


def test_speculative_missing_params_raises():
    ctx = _ctx(["a", "b"], {"fake": FakeBackend()})
    with pytest.raises(ValueError, match="drafter and verifier"):
        _collect("speculative", ctx)


def test_speculative_short_verifier_terminates_early():
    backends = {"fake": ScriptedBackend("ab", "c")}
    swarm = {"drafter": _agent("drafter"), "verifier": _agent("verifier")}
    ctx = ModeContext(
        swarm=swarm,
        backends=backends,
        agents=["drafter", "verifier"],
        params={"drafter": "drafter", "verifier": "verifier", "block_size": 32},
        request_id="test",
    )
    events = _collect("speculative", ctx)
    assert events[-1].kind == "result"


# ---------------------------------------------------------------------------
# critic_debate
# ---------------------------------------------------------------------------

def test_critic_debate_ships_on_first_round():
    backends = {"fake": ScriptedBackend("proposal", "SHIP looks good")}
    swarm = {"gen": _agent("gen"), "critic": _agent("critic")}
    ctx = ModeContext(
        swarm=swarm,
        backends=backends,
        agents=["gen", "critic"],
        params={"generator": "gen", "critic": "critic", "max_rounds": 3},
        request_id="test",
    )
    events = _collect("critic_debate", ctx)
    assert events[-1].kind == "result"
    assert events[-1].meta["verdict"] == "SHIP"
    assert events[-1].meta["rounds"] == 1
    assert events[-1].text == "proposal"


def test_critic_debate_max_rounds_when_no_ship():
    backends = {"fake": ScriptedBackend("v1", "REWRITE fix it", "v2", "REWRITE again", "v3", "REWRITE still")}
    swarm = {"gen": _agent("gen"), "critic": _agent("critic")}
    ctx = ModeContext(
        swarm=swarm,
        backends=backends,
        agents=["gen", "critic"],
        params={"generator": "gen", "critic": "critic", "max_rounds": 2},
        request_id="test",
    )
    events = _collect("critic_debate", ctx)
    assert events[-1].meta["verdict"] == "MAX_ROUNDS"
    assert events[-1].meta["rounds"] == 2


def test_critic_debate_missing_roles_raises():
    ctx = _ctx(["a"], {"fake": FakeBackend()})
    with pytest.raises(ValueError, match="generator and critic"):
        _collect("critic_debate", ctx)


# ---------------------------------------------------------------------------
# tree_of_thought
# ---------------------------------------------------------------------------

def test_tree_of_thought_branches_scores_and_prunes():
    backends = {"fake": ScriptedBackend("branch-a", "branch-b", "branch-c", "7", "6", "3", "8", "7", "6")}
    swarm = {"gen": _agent("gen"), "scorer": _agent("scorer")}
    ctx = ModeContext(
        swarm=swarm,
        backends=backends,
        agents=["gen", "scorer"],
        params={
            "generator": "gen",
            "scorer": "scorer",
            "depth": 1,
            "branching": 3,
            "prune_below": 5.0,
        },
        request_id="test",
    )
    events = _collect("tree_of_thought", ctx)
    assert events[-1].kind == "result"
    assert events[-1].meta["mode"] == "tree_of_thought"
    token = next(e for e in events if e.kind == "token" and e.meta and "score" in e.meta)
    assert token.meta["score"] >= 5.0


def test_tree_of_thought_defaults_generator_scorer_from_agents():
    backends = {"fake": ScriptedBackend("step", "9")}
    ctx = ModeContext(
        swarm={"a": _agent("a"), "b": _agent("b")},
        backends=backends,
        agents=["a", "b"],
        params={"depth": 1, "branching": 1, "prune_below": 0.0},
        request_id="test",
    )
    events = _collect("tree_of_thought", ctx)
    assert events[-1].kind == "result"


def test_tree_of_thought_no_agents_raises():
    ctx = ModeContext(
        swarm={},
        backends={"fake": FakeBackend()},
        agents=[],
        params={},
        request_id="test",
    )
    with pytest.raises(ValueError, match="generator and scorer"):
        _collect("tree_of_thought", ctx)
