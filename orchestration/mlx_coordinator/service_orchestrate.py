"""POST /api/orchestrate — Python-backend orchestration mode dispatcher.

Registered in service.make_app() alongside /api/mlx/* routes.
Accepts {mode, prompt, params, session_id} and dispatches to the
appropriate Python OrchestrationMode, returning blocking JSON.
SSE streaming passthrough is added in MS-25-2.

Modes registered here: map_reduce, speculative, critic_debate.
tree_of_thought is stretch and registered once MS-25-4 caps prove stable.
"""
from __future__ import annotations

import logging
import uuid
from typing import Any

from aiohttp import web

from orchestration.modes.base import ModeContext
from orchestration.modes.critic_debate import CriticDebateMode
from orchestration.modes.map_reduce import MapReduceMode
from orchestration.modes.speculative import SpeculativeMode

logger = logging.getLogger(__name__)

_PYTHON_MODES = {m.mode_id: m for m in [MapReduceMode(), SpeculativeMode(), CriticDebateMode()]}


async def handle_orchestrate(request: web.Request) -> web.Response:
    try:
        body = await request.json()
        if not isinstance(body, dict):
            raise ValueError(f"expected JSON object, got {type(body).__name__}")
    except Exception as exc:
        logger.error("orchestrate: bad JSON: %s", exc)
        raise web.HTTPBadRequest(reason="invalid JSON")

    mode_id = (body.get("mode") or "").strip()
    if not mode_id:
        raise web.HTTPBadRequest(reason="'mode' required")

    prompt = (body.get("prompt") or "").strip()
    if not prompt:
        raise web.HTTPBadRequest(reason="'prompt' required")

    mode = _PYTHON_MODES.get(mode_id)
    if mode is None:
        raise web.HTTPBadRequest(
            reason=f"unknown Python mode {mode_id!r} — choose from {list(_PYTHON_MODES)}"
        )

    session_id = (body.get("session_id") or "").strip() or str(uuid.uuid4())
    params: dict[str, Any] = body.get("params") or {}

    try:
        ctx = ModeContext(
            swarm=request.app["swarm"],
            backends=request.app["backends"],
            agents=list(request.app["swarm"].keys()),
            params=params,
            request_id=session_id,
        )
        parts: list[str] = []
        meta: dict[str, Any] = {}
        async for event in mode.execute(ctx, prompt):
            if event.kind == "token":
                parts.append(event.text)
            elif event.kind == "result" and event.meta:
                meta = dict(event.meta)
            elif event.kind == "error":
                logger.error("orchestrate: mode=%s agent=%s error: %s",
                             mode_id, event.agent_id, event.text)
    except Exception as exc:
        logger.error("orchestrate: mode=%s session=%s failed: %s", mode_id, session_id, exc)
        raise web.HTTPInternalServerError(reason=str(exc))

    return web.json_response(
        {"result": "".join(parts), "session_id": session_id, "mode": mode_id, "meta": meta}
    )


def register_orchestrate_routes(app: web.Application) -> None:
    app.router.add_post("/api/orchestrate", handle_orchestrate)
