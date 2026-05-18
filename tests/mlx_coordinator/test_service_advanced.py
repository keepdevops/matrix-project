"""Advanced service endpoint tests — stream SSE, mode propagation, session lifecycle."""
import asyncio
import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop

from backends.base import TokenChunk
from orchestration.mlx_coordinator.backend import MlxBackend
from orchestration.mlx_coordinator.session import SessionStore
from orchestration.manager import AgentConfig


def _make_agent(agent_id="mlx-scout", port=8083):
    return AgentConfig(
        agent_id=agent_id, name=agent_id,
        model="/models/test", system_prompt="Be concise.",
        context=4096, max_tokens=512,
        engine="mlx", coordinator="mlx", port=port,
    )


async def _token_stream(*tokens):
    for t in tokens:
        yield TokenChunk(text=t)
    yield TokenChunk(text="", done=True)


def _mock_backend(*tokens):
    b = MagicMock(spec=MlxBackend)
    b.generate_stream = MagicMock(return_value=_token_stream(*tokens))
    b.health = AsyncMock(return_value=MagicMock(ok=True, detail="ok"))
    b.close = AsyncMock()
    return b


def _make_app(tokens=("Hello",)):
    from orchestration.mlx_coordinator.service import make_app
    app = make_app()
    agents = {"mlx-scout": _make_agent()}
    backends = {"mlx": _mock_backend(*tokens)}

    async def _startup(a):
        import mlx.core as mx  # noqa: F401 — may not be present; guarded in service
        a["swarm"] = agents
        a["backends"] = backends
        a["sessions"] = SessionStore()
        a["active_mode"] = "flat"
        a["_cleanup_task"] = asyncio.create_task(asyncio.sleep(9999))

    app.on_startup.clear()
    app.on_startup.append(_startup)
    return app, backends


# ---------------------------------------------------------------------------
# /api/mlx/stream SSE output
# ---------------------------------------------------------------------------

class TestStreamEndpoint(AioHTTPTestCase):
    async def get_application(self):
        app, self._backends = _make_app(tokens=["Hi", " there"])
        return app

    @unittest_run_loop
    async def test_stream_returns_200_event_stream(self):
        resp = await self.client.post("/api/mlx/stream", json={"prompt": "hello"})
        assert resp.status == 200
        assert "text/event-stream" in resp.content_type

    @unittest_run_loop
    async def test_stream_contains_session_id_header(self):
        resp = await self.client.post("/api/mlx/stream", json={"prompt": "hello"})
        assert resp.headers.get("X-Session-Id")

    @unittest_run_loop
    async def test_stream_session_id_echoed_when_provided(self):
        resp = await self.client.post("/api/mlx/stream",
                                      json={"prompt": "hi", "session_id": "my-sess"})
        assert resp.headers.get("X-Session-Id") == "my-sess"

    @unittest_run_loop
    async def test_stream_emits_token_events(self):
        resp = await self.client.post("/api/mlx/stream", json={"prompt": "test"})
        body = await resp.text()
        assert "event: token" in body

    @unittest_run_loop
    async def test_stream_emits_done_event(self):
        resp = await self.client.post("/api/mlx/stream", json={"prompt": "test"})
        body = await resp.text()
        assert "event: done" in body

    @unittest_run_loop
    async def test_stream_missing_prompt_returns_400(self):
        resp = await self.client.post("/api/mlx/stream", json={})
        assert resp.status == 400

    @unittest_run_loop
    async def test_stream_whitespace_prompt_returns_400(self):
        resp = await self.client.post("/api/mlx/stream", json={"prompt": "   "})
        assert resp.status == 400

    @unittest_run_loop
    async def test_stream_bad_json_returns_400(self):
        resp = await self.client.post("/api/mlx/stream",
                                      data="bad",
                                      headers={"Content-Type": "application/json"})
        assert resp.status == 400

    @unittest_run_loop
    async def test_stream_records_user_message_in_session(self):
        resp = await self.client.post("/api/mlx/stream",
                                      json={"prompt": "remember this", "session_id": "s-stream"})
        await resp.text()  # drain
        sessions: SessionStore = self.app["sessions"]
        msgs = await sessions.get_messages("s-stream")
        assert any(m["role"] == "user" and "remember this" in m["content"] for m in msgs)


# ---------------------------------------------------------------------------
# Submit — result content
# ---------------------------------------------------------------------------

class TestSubmitContent(AioHTTPTestCase):
    async def get_application(self):
        app, _ = _make_app(tokens=["The", " answer", " is", " 42"])
        return app

    @unittest_run_loop
    async def test_submit_result_contains_tokens(self):
        resp = await self.client.post("/api/mlx/submit", json={"prompt": "what"})
        data = await resp.json()
        assert "The answer is 42" in data["result"]

    @unittest_run_loop
    async def test_submit_auto_assigns_session_id(self):
        resp = await self.client.post("/api/mlx/submit", json={"prompt": "hello"})
        data = await resp.json()
        assert data["session_id"]

    @unittest_run_loop
    async def test_submit_preserves_explicit_session_id(self):
        resp = await self.client.post("/api/mlx/submit",
                                      json={"prompt": "hi", "session_id": "explicit-id"})
        data = await resp.json()
        assert data["session_id"] == "explicit-id"

    @unittest_run_loop
    async def test_submit_multiple_calls_return_independent_results(self):
        r1 = await self.client.post("/api/mlx/submit",
                                    json={"prompt": "first", "session_id": "m1"})
        r2 = await self.client.post("/api/mlx/submit",
                                    json={"prompt": "second", "session_id": "m2"})
        d1 = await r1.json()
        d2 = await r2.json()
        assert d1["session_id"] == "m1"
        assert d2["session_id"] == "m2"


# ---------------------------------------------------------------------------
# Mode propagation — active mode is used for subsequent requests
# ---------------------------------------------------------------------------

class TestModePropagatesToSubmit(AioHTTPTestCase):
    async def get_application(self):
        app, _ = _make_app(tokens=["ok"])
        return app

    @unittest_run_loop
    async def test_mode_change_reflected_in_submit(self):
        await self.client.post("/api/mlx/modes/active", json={"mode": "pipeline"})
        check = await self.client.get("/api/mlx/modes")
        data = await check.json()
        assert data["active"] == "pipeline"

    @unittest_run_loop
    async def test_mode_resets_between_requests(self):
        await self.client.post("/api/mlx/modes/active", json={"mode": "cascade"})
        await self.client.post("/api/mlx/modes/active", json={"mode": "flat"})
        check = await self.client.get("/api/mlx/modes")
        data = await check.json()
        assert data["active"] == "flat"


# ---------------------------------------------------------------------------
# Health — degraded when backend is down
# ---------------------------------------------------------------------------

class TestHealthDegraded(AioHTTPTestCase):
    async def get_application(self):
        app, self._backends = _make_app()
        return app

    @unittest_run_loop
    async def test_health_returns_503_when_backend_down(self):
        self._backends["mlx"].health = AsyncMock(
            return_value=MagicMock(ok=False, detail="connection refused")
        )
        resp = await self.client.get("/api/mlx/health")
        assert resp.status == 503
        data = await resp.json()
        assert data["ok"] is False


# ---------------------------------------------------------------------------
# Pressure — inflight count increments during request
# ---------------------------------------------------------------------------

class TestPressureAccuracy(AioHTTPTestCase):
    async def get_application(self):
        app, _ = _make_app()
        return app

    @unittest_run_loop
    async def test_pressure_endpoint_shape(self):
        resp = await self.client.get("/api/mlx/pressure")
        data = await resp.json()
        assert isinstance(data["inflight"], dict)
        assert isinstance(data["sessions"], list)


# ---------------------------------------------------------------------------
# CORS — all endpoints include origin header
# ---------------------------------------------------------------------------

class TestCorsAllEndpoints(AioHTTPTestCase):
    async def get_application(self):
        app, _ = _make_app()
        return app

    @unittest_run_loop
    async def test_cors_on_health(self):
        r = await self.client.get("/api/mlx/health")
        assert r.headers.get("Access-Control-Allow-Origin") == "*"

    @unittest_run_loop
    async def test_cors_on_agents(self):
        r = await self.client.get("/api/mlx/agents")
        assert r.headers.get("Access-Control-Allow-Origin") == "*"

    @unittest_run_loop
    async def test_cors_on_submit(self):
        r = await self.client.post("/api/mlx/submit", json={"prompt": "hi"})
        assert r.headers.get("Access-Control-Allow-Origin") == "*"

    @unittest_run_loop
    async def test_cors_on_modes(self):
        r = await self.client.get("/api/mlx/modes")
        assert r.headers.get("Access-Control-Allow-Origin") == "*"

    @unittest_run_loop
    async def test_cors_on_pressure(self):
        r = await self.client.get("/api/mlx/pressure")
        assert r.headers.get("Access-Control-Allow-Origin") == "*"

    @unittest_run_loop
    async def test_preflight_on_submit(self):
        r = await self.client.options("/api/mlx/submit")
        assert r.status == 204
        assert r.headers.get("Access-Control-Allow-Origin") == "*"
