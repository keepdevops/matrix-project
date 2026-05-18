"""Python MLX coordinator — hard barrier between mlx-lm and llama-server.

Runs on port 3003. All /api/mlx/* traffic from Nginx lands here.
The C++ coordinator (port 3002) never sees MLX agents.

Endpoints:
    POST /api/mlx/stream          SSE streaming chat
    POST /api/mlx/submit          Blocking chat (returns full response)
    GET  /api/mlx/health          Service + model health
    GET  /api/mlx/agents          MLX agents loaded from config/agents/
    GET  /api/mlx/modes           Supported modes
    POST /api/mlx/modes/active    Set active mode
    POST /api/mlx/session/clear   Explicit session cache flush
    GET  /api/mlx/pressure        Per-port inflight request counts

CLAUDE.md §2: every except block logs. §1: this file stays under 300 LOC.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid
from typing import Any

import mlx.core as mx
from aiohttp import web

from orchestration.manager import SwarmFactory
from orchestration.modes.base import ModeContext
from orchestration.modes.cascade import CascadeMode
from orchestration.modes.flat import FlatMode
from orchestration.modes.pipeline import PipelineMode
from orchestration.mlx_coordinator.backend import MlxBackend, get_pressure
from orchestration.mlx_coordinator.session import SessionStore

logger = logging.getLogger(__name__)

_MODES = {m.mode_id: m for m in [FlatMode(), PipelineMode(), CascadeMode()]}
_DEFAULT_MODE = "flat"
_IDLE_CLEANUP_INTERVAL = 60  # seconds


# ---------------------------------------------------------------------------
# CORS middleware
# ---------------------------------------------------------------------------

def _cors(resp: web.StreamResponse) -> web.StreamResponse:
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return resp


@web.middleware
async def cors_mw(request: web.Request, handler: Any) -> web.StreamResponse:
    if request.method == "OPTIONS":
        return _cors(web.Response(status=204))
    try:
        resp = await handler(request)
    except web.HTTPException as exc:
        _cors(exc)
        raise
    return _cors(resp)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _build_backends(swarm: dict) -> dict:
    """One MlxBackend per agent (each gets its own port + system prompt)."""
    backends: dict[str, MlxBackend] = {}
    for agent_id, cfg in swarm.items():
        key = cfg.engine or cfg.server_group or agent_id
        backends[key] = MlxBackend(
            port=cfg.port or 8083,
            agent_id=agent_id,
            system_prompt=cfg.system_prompt,
            max_tokens=cfg.max_tokens,
        )
    return backends


# ---------------------------------------------------------------------------
# Handlers
# ---------------------------------------------------------------------------

async def handle_stream(request: web.Request) -> web.StreamResponse:
    try:
        body = await request.json()
        if not isinstance(body, dict):
            raise ValueError(f"expected JSON object, got {type(body).__name__}")
    except Exception as exc:
        logger.error("mlx-coord: bad JSON in /stream: %s", exc)
        raise web.HTTPBadRequest(reason="invalid JSON")

    prompt = (body.get("prompt") or "").strip()
    if not prompt:
        raise web.HTTPBadRequest(reason="'prompt' required")

    session_id = body.get("session_id") or str(uuid.uuid4())
    mode_id: str = request.app["active_mode"]
    params: dict = body.get("params") or {}
    sessions: SessionStore = request.app["sessions"]

    resp = web.StreamResponse(headers={"Content-Type": "text/event-stream",
                                       "Cache-Control": "no-cache",
                                       "X-Session-Id": session_id})
    await resp.prepare(request)

    async def send(event: str, data: str) -> None:
        await resp.write(f"event: {event}\ndata: {data}\n\n".encode())

    await sessions.append_message(session_id, "user", prompt)

    try:
        mode = _MODES.get(mode_id)
        if mode is None:
            raise ValueError(f"unknown mode: {mode_id!r}")
        swarm = request.app["swarm"]
        backends = request.app["backends"]
        ctx = ModeContext(swarm=swarm, backends=backends, agents=list(swarm.keys()),
                          params=params, request_id=session_id)
        full_response: list[str] = []
        async for event in mode.execute(ctx, prompt):
            if event.kind == "token":
                full_response.append(event.text)
                await send("token", json.dumps({"text": event.text,
                                                "agent_id": event.agent_id}))
            elif event.kind in ("agent_start", "agent_end"):
                await send(event.kind, json.dumps({"agent_id": event.agent_id}))
            elif event.kind == "result":
                await send("done", json.dumps({"meta": event.meta}))
            elif event.kind == "error":
                logger.error("mlx-coord: mode error agent=%s: %s", event.agent_id, event.text)
                await send("error", json.dumps({"error": event.text,
                                                "agent_id": event.agent_id}))
        await sessions.append_message(session_id, "assistant", "".join(full_response))
    except Exception as exc:
        logger.error("mlx-coord: stream handler failed session=%s: %s", session_id, exc)
        await send("error", json.dumps({"error": str(exc)}))

    return resp


async def handle_submit(request: web.Request) -> web.Response:
    try:
        body = await request.json()
        if not isinstance(body, dict):
            raise ValueError(f"expected JSON object, got {type(body).__name__}")
    except Exception as exc:
        logger.error("mlx-coord: bad JSON in /submit: %s", exc)
        raise web.HTTPBadRequest(reason="invalid JSON")

    prompt = (body.get("prompt") or "").strip()
    if not prompt:
        raise web.HTTPBadRequest(reason="'prompt' required")

    session_id = body.get("session_id") or str(uuid.uuid4())
    mode_id: str = request.app["active_mode"]
    mode = _MODES.get(mode_id)
    if mode is None:
        raise web.HTTPBadRequest(reason=f"unknown mode {mode_id!r}")
    try:
        ctx = ModeContext(swarm=request.app["swarm"], backends=request.app["backends"],
                          agents=list(request.app["swarm"].keys()),
                          params=body.get("params") or {}, request_id=session_id)
        parts: list[str] = []
        async for event in mode.execute(ctx, prompt):
            if event.kind == "token":
                parts.append(event.text)
        result = "".join(parts)
    except Exception as exc:
        logger.error("mlx-coord: submit failed session=%s: %s", session_id, exc)
        raise web.HTTPInternalServerError(reason=str(exc))

    return web.json_response({"result": result, "session_id": session_id})


async def handle_health(request: web.Request) -> web.Response:
    backends: dict[str, MlxBackend] = request.app["backends"]
    statuses = {}
    for key, backend in backends.items():
        hs = await backend.health()
        statuses[key] = {"ok": hs.ok, "detail": hs.detail}
    overall = all(s["ok"] for s in statuses.values())
    return web.json_response({"ok": overall, "backends": statuses},
                             status=200 if overall else 503)


async def handle_agents(request: web.Request) -> web.Response:
    swarm = request.app["swarm"]
    return web.json_response({k: v.model_dump() for k, v in swarm.items()})


async def handle_modes(request: web.Request) -> web.Response:
    return web.json_response({"modes": list(_MODES.keys()),
                               "active": request.app["active_mode"]})


async def handle_set_mode(request: web.Request) -> web.Response:
    try:
        body = await request.json()
        if not isinstance(body, dict):
            raise ValueError(f"expected JSON object, got {type(body).__name__}")
    except Exception as exc:
        logger.error("mlx-coord: bad JSON in set_mode: %s", exc)
        raise web.HTTPBadRequest(reason="invalid JSON")
    mode_id = (body.get("mode") or "").strip()
    if mode_id not in _MODES:
        raise web.HTTPBadRequest(reason=f"unknown mode {mode_id!r}, choose from {list(_MODES)}")
    request.app["active_mode"] = mode_id
    return web.json_response({"active": mode_id})


async def handle_session_clear(request: web.Request) -> web.Response:
    try:
        body = await request.json()
        if not isinstance(body, dict):
            raise ValueError(f"expected JSON object, got {type(body).__name__}")
    except Exception as exc:
        logger.error("mlx-coord: bad JSON in session/clear: %s", exc)
        raise web.HTTPBadRequest(reason="invalid JSON")
    session_id = (body.get("session_id") or "").strip()
    sessions: SessionStore = request.app["sessions"]
    if session_id:
        cleared = await sessions.clear(session_id)
        return web.json_response({"cleared": [session_id] if cleared else []})
    count = await sessions.clear_all()
    return web.json_response({"cleared_count": count})


async def handle_pressure(request: web.Request) -> web.Response:
    sessions: SessionStore = request.app["sessions"]
    return web.json_response({"inflight": get_pressure(),
                               "sessions": sessions.snapshot()})


# ---------------------------------------------------------------------------
# App factory
# ---------------------------------------------------------------------------

async def _idle_cleanup_loop(app: web.Application) -> None:
    while True:
        await asyncio.sleep(_IDLE_CLEANUP_INTERVAL)
        try:
            n = await app["sessions"].cleanup_idle()
            if n:
                logger.info("mlx-coord: idle cleanup evicted %d sessions", n)
        except Exception as exc:
            logger.error("mlx-coord: idle cleanup error: %s", exc)


def make_app() -> web.Application:
    app = web.Application(middlewares=[cors_mw])

    async def on_startup(a: web.Application) -> None:
        mx.set_wired_limit(20 * 1024 * 1024 * 1024)
        factory = SwarmFactory()
        all_agents = factory.load_swarm()
        mlx_agents = {k: v for k, v in all_agents.items() if v.engine == "mlx"}
        if not mlx_agents:
            logger.error("mlx-coord: no agents with engine='mlx' found in config/agents/")
            raise RuntimeError("no MLX agents configured")
        a["swarm"] = mlx_agents
        a["backends"] = _build_backends(mlx_agents)
        a["sessions"] = SessionStore()
        a["active_mode"] = _DEFAULT_MODE
        a["_cleanup_task"] = asyncio.create_task(_idle_cleanup_loop(a))
        logger.info("mlx-coord: loaded %d MLX agents, mode=%s", len(mlx_agents), _DEFAULT_MODE)

    async def on_cleanup(a: web.Application) -> None:
        a["_cleanup_task"].cancel()
        for backend in a["backends"].values():
            await backend.close()
        await a["sessions"].clear_all()

    app.on_startup.append(on_startup)
    app.on_cleanup.append(on_cleanup)

    app.router.add_post("/api/mlx/stream", handle_stream)
    app.router.add_post("/api/mlx/submit", handle_submit)
    app.router.add_get("/api/mlx/health", handle_health)
    app.router.add_get("/api/mlx/agents", handle_agents)
    app.router.add_get("/api/mlx/modes", handle_modes)
    app.router.add_post("/api/mlx/modes/active", handle_set_mode)
    app.router.add_post("/api/mlx/session/clear", handle_session_clear)
    app.router.add_get("/api/mlx/pressure", handle_pressure)
    return app


def main() -> None:
    import argparse
    logging.basicConfig(
        level=os.environ.get("MLX_COORD_LOG", "INFO"),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    p = argparse.ArgumentParser(prog="mlx-coordinator")
    p.add_argument("--host", default=os.environ.get("MLX_COORD_HOST", "127.0.0.1"))
    p.add_argument("--port", type=int,
                   default=int(os.environ.get("MLX_COORD_PORT", "3003")))
    args = p.parse_args()
    web.run_app(make_app(), host=args.host, port=args.port)

if __name__ == "__main__":
    main()
