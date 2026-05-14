"""Helper: build a RAG context block for a single agent.

A mode calls `build_rag_block(query, agent, ctx)`; if the agent's config
has `rag.enabled: true` AND the ModeContext was given an embedder+store,
this performs a top-k retrieval and returns an XML-tagged block ready to
splice into the agent's prompt. Otherwise returns "".

Keeps modes telemetry-free and RAG-optional — modes don't import the
RAG layer directly.
"""
from __future__ import annotations

import logging
from typing import Any

from orchestration.manager import AgentConfig

logger = logging.getLogger(__name__)


async def build_rag_block(query: str, agent: AgentConfig, ctx: Any) -> str:
    rag_cfg = agent.rag or {}
    if not rag_cfg.get("enabled"):
        return ""
    if ctx.embedder is None or ctx.store is None:
        logger.error("rag.enabled for %s but ctx.embedder/store not set", agent.agent_id)
        return ""

    # Import lazily so modes/base.py stays importable in trivial unit tests.
    from orchestration.rag.retrieve import retrieve

    k = int(rag_cfg.get("k", 3))
    try:
        hits = await retrieve(query, embedder=ctx.embedder, store=ctx.store, k=k)
    except Exception as exc:
        logger.error("rag retrieve for %s failed: %s", agent.agent_id, exc)
        return ""
    if not hits:
        return ""

    parts = [
        f"<chunk path={h.source_path!r} distance={h.distance:.4f}>\n{h.content}\n</chunk>"
        for h in hits
    ]
    return "<retrieved>\n" + "\n".join(parts) + "\n</retrieved>"
