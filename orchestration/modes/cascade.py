"""Cascade mode — agents run in order, then a designated synthesizer merges outputs."""
from __future__ import annotations

import logging
from typing import AsyncIterator

from backends.base import GenerateRequest
from .base import Event, ModeContext, OrchestrationMode

logger = logging.getLogger(__name__)


class CascadeMode(OrchestrationMode):
    mode_id = "cascade"

    async def execute(self, ctx: ModeContext, query: str) -> AsyncIterator[Event]:
        if not ctx.agents:
            logger.error("cascade: empty agents (request_id=%s)", ctx.request_id)
            raise ValueError("cascade mode: empty agents list")

        synthesizer = ctx.params.get("synthesizer") or ctx.agents[-1]
        outputs: dict[str, str] = {}

        for agent_id in ctx.agents:
            cfg = ctx.agent(agent_id)
            backend = ctx.backend_for(agent_id)
            yield Event(kind="agent_start", agent_id=agent_id)
            buf: list[str] = []
            try:
                async for chunk in backend.generate_stream(
                    GenerateRequest(
                        prompt=f"<system>{cfg.system_prompt}</system>\n<query>{query}</query>",
                        max_tokens=cfg.max_tokens,
                    )
                ):
                    if chunk.text:
                        buf.append(chunk.text)
                        yield Event(kind="token", agent_id=agent_id, text=chunk.text)
            except Exception as exc:
                logger.error("cascade: agent %s failed: %s", agent_id, exc)
                yield Event(kind="error", agent_id=agent_id, text=str(exc))
                return
            outputs[agent_id] = "".join(buf)
            yield Event(kind="agent_end", agent_id=agent_id)

        synth_cfg = ctx.agent(synthesizer)
        synth_backend = ctx.backend_for(synthesizer)
        sections = "\n\n".join(
            f"<from agent={a!r}>\n{outputs[a]}\n</from>" for a in ctx.agents
        )
        synth_prompt = (
            f"<system>{synth_cfg.system_prompt}</system>\n"
            f"<query>{query}</query>\n<contributions>\n{sections}\n</contributions>"
        )
        final_buf: list[str] = []
        yield Event(kind="agent_start", agent_id=synthesizer, meta={"role": "synthesizer"})
        try:
            async for chunk in synth_backend.generate_stream(
                GenerateRequest(prompt=synth_prompt, max_tokens=synth_cfg.max_tokens)
            ):
                if chunk.text:
                    final_buf.append(chunk.text)
                    yield Event(kind="token", agent_id=synthesizer, text=chunk.text)
        except Exception as exc:
            logger.error("cascade synth %s failed: %s", synthesizer, exc)
            yield Event(kind="error", agent_id=synthesizer, text=str(exc))
            return
        yield Event(kind="agent_end", agent_id=synthesizer)

        yield Event(
            kind="result",
            text="".join(final_buf),
            meta={"mode": "cascade", "synthesizer": synthesizer},
        )
