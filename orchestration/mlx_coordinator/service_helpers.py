"""Middleware, request parsing, and mode-state persistence for the MLX coordinator.

Kept separate so service.py stays under 300 LOC (CLAUDE.md §1).
"""
from __future__ import annotations

import json
import logging
import os
import time
from pathlib import Path
from typing import Any

from aiohttp import web

logger = logging.getLogger(__name__)

_STATE_FILE = Path(os.environ.get("MLX_STATE_FILE",
                                   Path(__file__).parent.parent.parent / ".mlx_coord_state.json"))


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
# Access log middleware
# ---------------------------------------------------------------------------

@web.middleware
async def access_log_mw(request: web.Request, handler: Any) -> web.StreamResponse:
    t0 = time.monotonic()
    session_id = request.headers.get("X-Session-Id", "")
    try:
        resp = await handler(request)
        ms = (time.monotonic() - t0) * 1000
        logger.info("mlx-access %s %s → %d  %.0fms%s",
                    request.method, request.path, resp.status, ms,
                    f" [{session_id}]" if session_id else "")
        return resp
    except web.HTTPException as exc:
        ms = (time.monotonic() - t0) * 1000
        logger.info("mlx-access %s %s → %d  %.0fms",
                    request.method, request.path, exc.status, ms)
        raise


# ---------------------------------------------------------------------------
# Safe JSON body parsing
# ---------------------------------------------------------------------------

async def parse_json_body(request: web.Request, context: str) -> dict:
    """Parse request body as a JSON object; raise HTTPBadRequest on any failure."""
    try:
        body = await request.json()
        if not isinstance(body, dict):
            raise ValueError(f"expected JSON object, got {type(body).__name__}")
        return body
    except Exception as exc:
        logger.error("mlx-coord: bad JSON in %s: %s", context, exc)
        raise web.HTTPBadRequest(reason="invalid JSON")


# ---------------------------------------------------------------------------
# Active mode persistence
# ---------------------------------------------------------------------------

def load_persisted_mode(default: str) -> str:
    """Read last active mode from state file; return default on any failure."""
    try:
        data = json.loads(_STATE_FILE.read_text())
        mode = data.get("active_mode", "")
        if isinstance(mode, str) and mode:
            return mode
    except FileNotFoundError:
        pass
    except Exception as exc:
        logger.error("mlx-coord: failed to read state file %s: %s", _STATE_FILE, exc)
    return default


def persist_mode(mode: str) -> None:
    """Write active mode to state file; log error but never raise."""
    try:
        existing: dict = {}
        try:
            existing = json.loads(_STATE_FILE.read_text())
        except FileNotFoundError:
            pass
        existing["active_mode"] = mode
        _STATE_FILE.write_text(json.dumps(existing))
    except Exception as exc:
        logger.error("mlx-coord: failed to persist mode %r: %s", mode, exc)
