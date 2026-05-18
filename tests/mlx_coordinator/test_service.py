"""Tests for the MLX coordinator aiohttp service endpoints.

Uses aiohttp.test_utils to spin up the app in-process — no real mlx_lm.server needed.
All MlxBackend.generate_stream calls are mocked to return canned tokens.
"""
import asyncio
import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop
from aiohttp import web

from orchestration.mlx_coordinator.session import SessionStore
from orchestration.mlx_coordinator.backend import MlxBackend
from orchestration.manager import AgentConfig
from backends.base import TokenChunk


# ---------------------------------------------------------------------------
# Shared fixtures
# ---------------------------------------------------------------------------

def _make_agent(agent_id="mlx-scout", port=8083) -> AgentConfig:
    return AgentConfig(
        agent_id=agent_id,
        name=agent_id,
        model="/models/test-mlx",
        system_prompt="Be concise.",
        context=4096,
        max_tokens=512,
        engine="mlx",
        coordinator="mlx",
        port=port,
    )


async def _token_stream(tokens):
    for t in tokens:
        yield TokenChunk(text=t)
    yield TokenChunk(text="", done=True)


def _mock_backend(tokens=("Hello", " world")):
    b = MagicMock(spec=MlxBackend)
    b.generate_stream = MagicMock(return_value=_token_stream(tokens))
    b.health = AsyncMock(return_value=MagicMock(ok=True, detail="ok"))
    b.close = AsyncMock()
    return b


def _make_app_with_mocks(agents=None, tokens=("Hello", " world")):
    """Build a test app with mocked swarm and backends."""
    from orchestration.mlx_coordinator.service import make_app
    app = make_app()

    agents = agents or {"mlx-scout": _make_agent()}
    backends = {
        (a.engine or a.server_group or a.agent_id): _mock_backend(tokens)
        for a in agents.values()
    }

    async def _override_startup(a):
        import mlx.core as mx
        a["swarm"] = agents
        a["backends"] = backends
        a["sessions"] = SessionStore()
        a["active_mode"] = "flat"
        a["_cleanup_task"] = asyncio.create_task(asyncio.sleep(9999))

    # Replace startup
    app.on_startup.clear()
    app.on_startup.append(_override_startup)
    return app, backends


# ---------------------------------------------------------------------------
# Health endpoint
# ---------------------------------------------------------------------------

class TestHealthEndpoint(AioHTTPTestCase):
    async def get_application(self):
        app, _ = _make_app_with_mocks()
        return app

    @unittest_run_loop
    async def test_health_ok(self):
        resp = await self.client.get("/api/mlx/health")
        assert resp.status == 200
        data = await resp.json()
        assert data["ok"] is True


# ---------------------------------------------------------------------------
# Agents endpoint
# ---------------------------------------------------------------------------

class TestAgentsEndpoint(AioHTTPTestCase):
    async def get_application(self):
        app, _ = _make_app_with_mocks()
        return app

    @unittest_run_loop
    async def test_agents_returns_mlx_agents(self):
        resp = await self.client.get("/api/mlx/agents")
        assert resp.status == 200
        data = await resp.json()
        assert "mlx-scout" in data


# ---------------------------------------------------------------------------
# Modes endpoints
# ---------------------------------------------------------------------------

class TestModesEndpoints(AioHTTPTestCase):
    async def get_application(self):
        app, _ = _make_app_with_mocks()
        return app

    @unittest_run_loop
    async def test_get_modes(self):
        resp = await self.client.get("/api/mlx/modes")
        assert resp.status == 200
        data = await resp.json()
        assert "flat" in data["modes"]
        assert "pipeline" in data["modes"]
        assert "cascade" in data["modes"]
        assert data["active"] == "flat"

    @unittest_run_loop
    async def test_set_valid_mode(self):
        resp = await self.client.post("/api/mlx/modes/active",
                                     json={"mode": "pipeline"})
        assert resp.status == 200
        data = await resp.json()
        assert data["active"] == "pipeline"

    @unittest_run_loop
    async def test_set_invalid_mode_returns_400(self):
        resp = await self.client.post("/api/mlx/modes/active",
                                     json={"mode": "nonexistent"})
        assert resp.status == 400

    @unittest_run_loop
    async def test_set_mode_bad_json_returns_400(self):
        resp = await self.client.post("/api/mlx/modes/active",
                                     data="not json",
                                     headers={"Content-Type": "application/json"})
        assert resp.status == 400


# ---------------------------------------------------------------------------
# Submit endpoint
# ---------------------------------------------------------------------------

class TestSubmitEndpoint(AioHTTPTestCase):
    async def get_application(self):
        app, _ = _make_app_with_mocks(tokens=["Hi", " there"])
        return app

    @unittest_run_loop
    async def test_submit_returns_result(self):
        resp = await self.client.post("/api/mlx/submit",
                                     json={"prompt": "test prompt"})
        assert resp.status == 200
        data = await resp.json()
        assert "result" in data
        assert "session_id" in data

    @unittest_run_loop
    async def test_submit_missing_prompt_returns_400(self):
        resp = await self.client.post("/api/mlx/submit", json={})
        assert resp.status == 400

    @unittest_run_loop
    async def test_submit_empty_prompt_returns_400(self):
        resp = await self.client.post("/api/mlx/submit",
                                     json={"prompt": "   "})
        assert resp.status == 400

    @unittest_run_loop
    async def test_submit_bad_json_returns_400(self):
        resp = await self.client.post("/api/mlx/submit",
                                     data="bad",
                                     headers={"Content-Type": "application/json"})
        assert resp.status == 400

    @unittest_run_loop
    async def test_submit_accepts_session_id(self):
        resp = await self.client.post("/api/mlx/submit",
                                     json={"prompt": "hello", "session_id": "sess-123"})
        assert resp.status == 200
        data = await resp.json()
        assert data["session_id"] == "sess-123"


# ---------------------------------------------------------------------------
# Session clear endpoint
# ---------------------------------------------------------------------------

class TestSessionClearEndpoint(AioHTTPTestCase):
    async def get_application(self):
        app, _ = _make_app_with_mocks()
        return app

    @unittest_run_loop
    async def test_clear_specific_session(self):
        # Seed the session store directly so we don't depend on submit flow
        sessions: SessionStore = self.app["sessions"]
        await sessions.get_or_create("to-clear")
        with patch("orchestration.mlx_coordinator.session._free_cache"):
            resp = await self.client.post("/api/mlx/session/clear",
                                          json={"session_id": "to-clear"})
        assert resp.status == 200
        data = await resp.json()
        assert "to-clear" in data.get("cleared", [])

    @unittest_run_loop
    async def test_clear_all_sessions(self):
        await self.client.post("/api/mlx/submit", json={"prompt": "hi"})
        with patch("orchestration.mlx_coordinator.session._free_cache"):
            resp = await self.client.post("/api/mlx/session/clear", json={})
        assert resp.status == 200
        data = await resp.json()
        assert "cleared_count" in data

    @unittest_run_loop
    async def test_clear_bad_json_returns_400(self):
        resp = await self.client.post("/api/mlx/session/clear",
                                      data="bad",
                                      headers={"Content-Type": "application/json"})
        assert resp.status == 400


# ---------------------------------------------------------------------------
# Pressure endpoint
# ---------------------------------------------------------------------------

class TestPressureEndpoint(AioHTTPTestCase):
    async def get_application(self):
        app, _ = _make_app_with_mocks()
        return app

    @unittest_run_loop
    async def test_pressure_returns_inflight_and_sessions(self):
        resp = await self.client.get("/api/mlx/pressure")
        assert resp.status == 200
        data = await resp.json()
        assert "inflight" in data
        assert "sessions" in data


# ---------------------------------------------------------------------------
# CORS middleware
# ---------------------------------------------------------------------------

class TestCors(AioHTTPTestCase):
    async def get_application(self):
        app, _ = _make_app_with_mocks()
        return app

    @unittest_run_loop
    async def test_options_returns_204_with_cors_headers(self):
        resp = await self.client.options("/api/mlx/health")
        assert resp.status == 204
        assert resp.headers.get("Access-Control-Allow-Origin") == "*"

    @unittest_run_loop
    async def test_get_response_has_cors_header(self):
        resp = await self.client.get("/api/mlx/health")
        assert resp.headers.get("Access-Control-Allow-Origin") == "*"
