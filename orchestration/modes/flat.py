"""Flat mode — run every agent on the same query in parallel, emit interleaved streams.

Python re-implementation of the existing C++ flat mode for the new plugin layout.
Mirrors the behavior contract of cpp_core/src/modes/flat.cpp.
"""
from __future__ import annotations

import asyncio
import logging
from typing import AsyncIterator

from backends.base import GenerateRequest
from .base import Event, ModeContext, OrchestrationMode

logger = logging.getLogger(__name__)


class FlatMode(OrchestrationMode):
    mode_id = "flat"

    async def execute(self, ctx: ModeContext, query: str) -> AsyncIterator[Event]:
        if not ctx.agents:
            logger.error("flat mode requires at least one agent (request_id=%s)",
                         ctx.request_id)
            raise ValueError("flat mode: empty agents list")

        queues: dict[str, asyncio.Queue[Event | None]] = {
            a: asyncio.Queue() for a in ctx.agents
        }

        async def run_one(agent_id: str) -> None:
            q = queues[agent_id]
            try:
                cfg = ctx.agent(agent_id)
                backend = ctx.backend_for(agent_id)
                await q.put(Event(kind="agent_start", agent_id=agent_id))
                req = GenerateRequest(
                    prompt=_compose_prompt(cfg.system_prompt, query),
                    max_tokens=cfg.max_tokens,
                )
                async for chunk in backend.generate_stream(req):
                    if chunk.text:
                        await q.put(Event(kind="token", agent_id=agent_id, text=chunk.text))
                await q.put(Event(kind="agent_end", agent_id=agent_id))
            except Exception as exc:
                logger.error("flat: agent %s failed: %s", agent_id, exc)
                await q.put(Event(kind="error", agent_id=agent_id, text=str(exc)))
            finally:
                await q.put(None)

        tasks = [asyncio.create_task(run_one(a)) for a in ctx.agents]
        remaining = set(ctx.agents)
        while remaining:
            done, _ = await asyncio.wait(
                [asyncio.create_task(queues[a].get()) for a in remaining],
                return_when=asyncio.FIRST_COMPLETED,
            )
            for fut in done:
                ev = fut.result()
                if ev is None:
                    # agent finished — find which one closed by peeking; simpler: track via sentinels
                    continue
                yield ev
                if ev.kind in ("agent_end", "error"):
                    remaining.discard(ev.agent_id or "")

        await asyncio.gather(*tasks, return_exceptions=True)
        yield Event(kind="result", text="", meta={"mode": "flat", "agents": list(ctx.agents)})


def _compose_prompt(system: str, user: str) -> str:
    return f"<system>{system}</system>\n<query>{user}</query>"
