"""Smoke tests for mode discovery and a FakeBackend round-trip."""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from typing import AsyncIterator, Sequence

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))

from backends.base import (  # noqa: E402
    GenerateRequest,
    HealthStatus,
    InferenceBackend,
    TokenChunk,
)
from orchestration.manager import AgentConfig  # noqa: E402
from orchestration.modes import discover_modes, get_mode  # noqa: E402
from orchestration.modes.base import ModeContext  # noqa: E402


class FakeBackend(InferenceBackend):
    backend_id = "fake"

    def __init__(self, reply: str = "ok") -> None:
        self.reply = reply

    async def generate_stream(self, req: GenerateRequest) -> AsyncIterator[TokenChunk]:
        for ch in self.reply:
            yield TokenChunk(text=ch)
        yield TokenChunk(text="", done=True)

    async def embed(self, texts: Sequence[str]) -> list[list[float]]:
        return [[0.0] * 4 for _ in texts]

    async def health(self) -> HealthStatus:
        return HealthStatus(ok=True)


def _make_ctx(agents: list[str]) -> ModeContext:
    swarm = {
        a: AgentConfig(
            agent_id=a,
            name=a,
            model="fake",
            system_prompt=f"you are {a}",
            context=2048,
            max_tokens=64,
            engine="fake",
        )
        for a in agents
    }
    return ModeContext(
        swarm=swarm,
        backends={"fake": FakeBackend(reply="hello")},
        agents=agents,
        request_id="test",
    )


def test_discover_modes_finds_all_eight():
    modes = discover_modes(force=True)
    assert set(modes) == {
        "flat", "pipeline", "cascade", "router",
        "speculative", "map_reduce", "critic_debate", "tree_of_thought",
    }


def test_pipeline_runs_through_fake_backend():
    cls = get_mode("pipeline")
    ctx = _make_ctx(["a", "b"])

    async def run() -> list:
        return [ev async for ev in cls().execute(ctx, "q")]

    events = asyncio.run(run())
    kinds = [e.kind for e in events]
    assert kinds.count("agent_start") == 2
    assert kinds.count("agent_end") == 2
    assert kinds[-1] == "result"
    assert events[-1].text  # accumulated tokens


def test_cascade_emits_synthesizer_result():
    cls = get_mode("cascade")
    ctx = _make_ctx(["a", "b"])
    ctx.params["synthesizer"] = "b"

    async def run() -> list:
        return [ev async for ev in cls().execute(ctx, "q")]

    events = asyncio.run(run())
    assert events[-1].kind == "result"
    assert events[-1].meta and events[-1].meta["synthesizer"] == "b"
