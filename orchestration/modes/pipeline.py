"""Pipeline mode — run agents in strict order, each consumes prior agent's output."""
from __future__ import annotations

import logging
from typing import AsyncIterator

from backends.base import GenerateRequest
from ._helpers.rag import build_rag_block
from .base import Event, ModeContext, OrchestrationMode

logger = logging.getLogger(__name__)


class PipelineMode(OrchestrationMode):
    mode_id = "pipeline"

    async def execute(self, ctx: ModeContext, query: str) -> AsyncIterator[Event]:
        order: list[str] = list(ctx.params.get("order") or ctx.agents)
        if not order:
            logger.error("pipeline: empty order (request_id=%s)", ctx.request_id)
            raise ValueError("pipeline mode: empty order")

        running_context = query
        for agent_id in order:
            cfg = ctx.agent(agent_id)
            backend = ctx.backend_for(agent_id)
            yield Event(kind="agent_start", agent_id=agent_id)

            rag_block = await build_rag_block(query, cfg, ctx)
            prompt = (
                f"<system>{cfg.system_prompt}</system>\n"
                f"{rag_block}\n<input>{running_context}</input>"
            )
            buf: list[str] = []
            try:
                async for chunk in backend.generate_stream(
                    GenerateRequest(prompt=prompt, max_tokens=cfg.max_tokens)
                ):
                    if chunk.text:
                        buf.append(chunk.text)
                        yield Event(kind="token", agent_id=agent_id, text=chunk.text)
            except Exception as exc:
                logger.error("pipeline: agent %s failed: %s", agent_id, exc)
                yield Event(kind="error", agent_id=agent_id, text=str(exc))
                return

            running_context = "".join(buf)
            yield Event(kind="agent_end", agent_id=agent_id)

        yield Event(
            kind="result",
            text=running_context,
            meta={"mode": "pipeline", "order": order},
        )
