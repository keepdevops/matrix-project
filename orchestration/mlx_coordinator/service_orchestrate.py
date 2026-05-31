"""POST /api/orchestrate — Python-backend orchestration mode dispatcher.

Registered in service.make_app() alongside /api/mlx/* routes.
Accepts {mode, prompt, params, session_id} and dispatches to the
appropriate Python OrchestrationMode, returning blocking JSON.
SSE streaming passthrough is added in MS-25-2.

Modes registered here: map_reduce, speculative, critic_debate.
tree_of_thought is stretch and registered once MS-25-4 caps prove stable.
"""
from __future__ import annotations

import json
import logging
import os
import uuid
from typing import Any

import aiohttp
from aiohttp import web

from orchestration.modes.base import ModeContext
from orchestration.modes.critic_debate import CriticDebateMode
from orchestration.modes.map_reduce import MapReduceMode
from orchestration.modes.speculative import SpeculativeMode
from orchestration.modes.tree_of_thought import TreeOfThoughtMode

logger = logging.getLogger(__name__)

_RAG_BASE = (
    os.environ.get("RAG_INGEST_HOST", "http://127.0.0.1")
    + ":"
    + os.environ.get("RAG_INGEST_PORT", "8001")
)


async def _fetch_rag_chunks(query: str, k: int = 3) -> list[dict[str, Any]]:
    """Call the RAG ingest service /retrieve and return chunk dicts."""
    url = f"{_RAG_BASE}/retrieve"
    try:
        async with aiohttp.ClientSession() as s:
            async with s.post(url, json={"query": query, "k": k}, timeout=aiohttp.ClientTimeout(total=10)) as r:
                if r.status != 200:
                    logger.error("rag retrieve HTTP %d from %s", r.status, url)
                    return []
                data = await r.json()
                return data.get("chunks") or []
    except Exception as exc:
        logger.error("rag retrieve failed (non-fatal): %s", exc)
        return []

_PYTHON_MODES = {m.mode_id: m for m in [MapReduceMode(), SpeculativeMode(), CriticDebateMode(), TreeOfThoughtMode()]}


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

    # For map_reduce with RAG enabled, retrieve top-k chunks and inject into params
    # so the mode can cite sources in each chunk prompt and the synthesizer output.
    if mode_id == "map_reduce" and body.get("use_rag"):
        k = int(body.get("rag_top_k") or 3)
        rag_chunks = await _fetch_rag_chunks(prompt, k=k)
        if rag_chunks:
            params = {**params, "rag_context": rag_chunks}

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


async def handle_orchestrate_stream(request: web.Request) -> web.StreamResponse:
    """POST /api/orchestrate/stream — SSE streaming variant of handle_orchestrate."""
    try:
        body = await request.json()
        if not isinstance(body, dict):
            raise ValueError(f"expected JSON object, got {type(body).__name__}")
    except Exception as exc:
        logger.error("orchestrate/stream: bad JSON: %s", exc)
        raise web.HTTPBadRequest(reason="invalid JSON")

    mode_id = (body.get("mode") or "").strip()
    prompt = (body.get("prompt") or "").strip()
    if not mode_id:
        raise web.HTTPBadRequest(reason="'mode' required")
    if not prompt:
        raise web.HTTPBadRequest(reason="'prompt' required")

    mode = _PYTHON_MODES.get(mode_id)
    if mode is None:
        raise web.HTTPBadRequest(
            reason=f"unknown Python mode {mode_id!r} — choose from {list(_PYTHON_MODES)}"
        )

    session_id = (body.get("session_id") or "").strip() or str(uuid.uuid4())
    params: dict[str, Any] = body.get("params") or {}

    if mode_id == "map_reduce" and body.get("use_rag"):
        k = int(body.get("rag_top_k") or 3)
        rag_chunks = await _fetch_rag_chunks(prompt, k=k)
        if rag_chunks:
            params = {**params, "rag_context": rag_chunks}

    resp = web.StreamResponse(headers={
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
        "Access-Control-Allow-Origin": "*",
    })
    await resp.prepare(request)

    async def send(event: str, data: str) -> None:
        await resp.write(f"event: {event}\ndata: {data}\n\n".encode())

    result_parts: list[str] = []
    final_meta: dict[str, Any] = {}
    try:
        ctx = ModeContext(
            swarm=request.app["swarm"],
            backends=request.app["backends"],
            agents=list(request.app["swarm"].keys()),
            params=params,
            request_id=session_id,
        )
        async for event in mode.execute(ctx, prompt):
            if event.kind == "token":
                result_parts.append(event.text)
                await send("token", json.dumps(
                    {"agent_id": event.agent_id, "text": event.text}))
            elif event.kind == "agent_start":
                await send("agent_start", json.dumps(
                    {"agent_id": event.agent_id, "meta": event.meta}))
            elif event.kind == "agent_end":
                await send("agent_end", json.dumps(
                    {"agent_id": event.agent_id}))
            elif event.kind == "result" and event.meta:
                final_meta = dict(event.meta)
            elif event.kind == "error":
                logger.error("orchestrate/stream: mode=%s agent=%s error: %s",
                             mode_id, event.agent_id, event.text)
                await send("error", json.dumps(
                    {"agent_id": event.agent_id, "error": event.text}))
    except Exception as exc:
        logger.error("orchestrate/stream: mode=%s session=%s failed: %s",
                     mode_id, session_id, exc)
        await send("error", json.dumps({"agent_id": None, "error": str(exc)}))
        return resp

    await send("done", json.dumps({
        "result": "".join(result_parts),
        "session_id": session_id,
        "mode": mode_id,
        "meta": final_meta,
    }))
    return resp


def register_orchestrate_routes(app: web.Application) -> None:
    app.router.add_post("/api/orchestrate", handle_orchestrate)
    app.router.add_post("/api/orchestrate/stream", handle_orchestrate_stream)
