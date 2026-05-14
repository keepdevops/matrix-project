"""Router mode — a planner picks a subset of agents, then runs flat over them."""
from __future__ import annotations

import logging
import re
from typing import AsyncIterator

from backends.base import GenerateRequest
from .base import Event, ModeContext, OrchestrationMode
from .flat import FlatMode

logger = logging.getLogger(__name__)


class RouterMode(OrchestrationMode):
    mode_id = "router"

    async def execute(self, ctx: ModeContext, query: str) -> AsyncIterator[Event]:
        if not ctx.agents:
            logger.error("router: empty agents (request_id=%s)", ctx.request_id)
            raise ValueError("router mode: empty agents list")
        max_select: int = int(ctx.params.get("max_select", 4))
        planner_id: str = ctx.params.get("planner") or ctx.agents[0]

        plan_prompt = (
            f"<task>Pick at most {max_select} agents from this list to answer the query. "
            f"Reply ONLY with a comma-separated list of agent ids.</task>\n"
            f"<agents>{', '.join(ctx.agents)}</agents>\n"
            f"<query>{query}</query>"
        )
        planner_cfg = ctx.agent(planner_id)
        planner_backend = ctx.backend_for(planner_id)
        yield Event(kind="agent_start", agent_id=planner_id, meta={"role": "planner"})
        plan_buf: list[str] = []
        try:
            async for chunk in planner_backend.generate_stream(
                GenerateRequest(prompt=plan_prompt, max_tokens=128)
            ):
                if chunk.text:
                    plan_buf.append(chunk.text)
        except Exception as exc:
            logger.error("router planner %s failed: %s", planner_id, exc)
            yield Event(kind="error", agent_id=planner_id, text=str(exc))
            return
        yield Event(kind="agent_end", agent_id=planner_id)

        selected = _parse_selection("".join(plan_buf), ctx.agents, max_select)
        if not selected:
            logger.error("router: planner returned no usable selection (raw=%r)",
                         "".join(plan_buf)[:200])
            selected = ctx.agents[:max_select]

        yield Event(kind="result", text="", meta={"phase": "selection", "selected": selected})

        flat_ctx = ModeContext(
            swarm=ctx.swarm,
            backends=ctx.backends,
            agents=selected,
            params=ctx.params,
            request_id=ctx.request_id,
        )
        async for ev in FlatMode().execute(flat_ctx, query):
            yield ev


def _parse_selection(raw: str, valid: list[str], max_n: int) -> list[str]:
    valid_set = set(valid)
    tokens = re.split(r"[,\s\n]+", raw.strip())
    out: list[str] = []
    for t in tokens:
        t = t.strip().strip("\"'`")
        if t in valid_set and t not in out:
            out.append(t)
            if len(out) >= max_n:
                break
    return out
