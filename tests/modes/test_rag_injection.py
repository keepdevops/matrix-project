"""Verify modes inject retrieved chunks when agent.rag.enabled is true."""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from typing import AsyncIterator, Sequence

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))

from backends.base import GenerateRequest, HealthStatus, InferenceBackend, TokenChunk  # noqa: E402
from orchestration.manager import AgentConfig  # noqa: E402
from orchestration.modes import get_mode  # noqa: E402
from orchestration.modes.base import ModeContext  # noqa: E402
from orchestration.rag.embed import HashEmbedder  # noqa: E402
from orchestration.rag.store import UpsertRow  # noqa: E402

sys.path.insert(0, str(REPO / "tests" / "rag"))
from test_rag import InMemoryStore  # noqa: E402


class CapturingBackend(InferenceBackend):
    backend_id = "capture"

    def __init__(self) -> None:
        self.prompts: list[str] = []

    async def generate_stream(self, req: GenerateRequest) -> AsyncIterator[TokenChunk]:
        self.prompts.append(req.prompt)
        yield TokenChunk(text="ok", done=True)

    async def embed(self, texts: Sequence[str]) -> list[list[float]]:
        return [[0.0] for _ in texts]

    async def health(self) -> HealthStatus:
        return HealthStatus(ok=True)


def test_pipeline_injects_rag_chunks_only_for_enabled_agents():
    async def go():
        emb = HashEmbedder()
        store = InMemoryStore()
        vecs = await emb.embed(["parse url string into components"])
        await store.upsert_chunks([UpsertRow(
            source_path="docs/url.md", chunk_idx=0,
            content="how to parse url strings", embedding=vecs[0], metadata={})])

        backend = CapturingBackend()
        agents = {
            "rag_agent": AgentConfig(
                agent_id="rag_agent", name="rag_agent", model="fake",
                system_prompt="you have RAG", context=2048, max_tokens=64,
                engine="capture", rag={"enabled": True, "k": 1}),
            "plain_agent": AgentConfig(
                agent_id="plain_agent", name="plain_agent", model="fake",
                system_prompt="you do not", context=2048, max_tokens=64,
                engine="capture"),
        }
        ctx = ModeContext(
            swarm=agents,
            backends={"capture": backend},
            agents=["rag_agent", "plain_agent"],
            embedder=emb, store=store,
        )
        cls = get_mode("pipeline")
        async for _ in cls().execute(ctx, "parse url string"):
            pass
        return backend.prompts

    prompts = asyncio.run(go())
    rag_prompt = next(p for p in prompts if "you have RAG" in p)
    plain_prompt = next(p for p in prompts if "you do not" in p)
    assert "<retrieved>" in rag_prompt
    assert "how to parse url strings" in rag_prompt
    assert "<retrieved>" not in plain_prompt
