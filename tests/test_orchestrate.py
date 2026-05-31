"""Tests for /api/orchestrate and /api/orchestrate/stream handlers."""
from __future__ import annotations

import asyncio
import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop

from backends.base import TokenChunk
from orchestration.manager import AgentConfig
from orchestration.mlx_coordinator.backend import MlxBackend
from orchestration.mlx_coordinator.session import SessionStore
from orchestration.mlx_coordinator.service_orchestrate import _fetch_rag_chunks


@pytest.fixture(autouse=True)
def _orchestrate_memory_guard_pass():
    with patch(
        "orchestration.mlx_coordinator.service_orchestrate.check_mode_memory_ok",
        return_value=(True, None),
    ):
        yield


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


def _make_agent(agent_id: str) -> AgentConfig:
    return AgentConfig(
        agent_id=agent_id,
        name=agent_id,
        model="/models/test",
        system_prompt=f"You are {agent_id}.",
        context=4096,
        max_tokens=64,
        engine="mlx",
        coordinator="mlx",
        port=8083,
    )


def _make_orchestrate_app(tokens=("ok",)):
    from orchestration.mlx_coordinator.service import make_app

    app = make_app()
    agents = {
        "worker": _make_agent("worker"),
        "synth": _make_agent("synth"),
        "drafter": _make_agent("drafter"),
        "verifier": _make_agent("verifier"),
        "gen": _make_agent("gen"),
        "critic": _make_agent("critic"),
        "generator": _make_agent("generator"),
        "scorer": _make_agent("scorer"),
    }
    backend = _mock_backend(*tokens)
    backends = {"mlx": backend}

    async def _startup(a):
        a["swarm"] = agents
        a["backends"] = backends
        a["sessions"] = SessionStore()
        a["active_mode"] = "flat"
        a["_cleanup_task"] = asyncio.create_task(asyncio.sleep(9999))

    app.on_startup.clear()
    app.on_startup.append(_startup)
    return app, backend


# ---------------------------------------------------------------------------
# _fetch_rag_chunks
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_fetch_rag_chunks_returns_chunks_on_200():
    mock_resp = AsyncMock()
    mock_resp.status = 200
    mock_resp.json = AsyncMock(return_value={"chunks": [{"content": "hit"}]})
    mock_resp.__aenter__ = AsyncMock(return_value=mock_resp)
    mock_resp.__aexit__ = AsyncMock(return_value=False)

    mock_session = AsyncMock()
    mock_session.post = MagicMock(return_value=mock_resp)
    mock_session.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session.__aexit__ = AsyncMock(return_value=False)

    with patch("orchestration.mlx_coordinator.service_orchestrate.aiohttp.ClientSession",
               return_value=mock_session):
        chunks = await _fetch_rag_chunks("query", k=2)
    assert chunks == [{"content": "hit"}]


@pytest.mark.asyncio
async def test_fetch_rag_chunks_returns_empty_on_http_error():
    mock_resp = AsyncMock()
    mock_resp.status = 503
    mock_resp.__aenter__ = AsyncMock(return_value=mock_resp)
    mock_resp.__aexit__ = AsyncMock(return_value=False)

    mock_session = AsyncMock()
    mock_session.post = MagicMock(return_value=mock_resp)
    mock_session.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session.__aexit__ = AsyncMock(return_value=False)

    with patch("orchestration.mlx_coordinator.service_orchestrate.aiohttp.ClientSession",
               return_value=mock_session):
        chunks = await _fetch_rag_chunks("query")
    assert chunks == []


@pytest.mark.asyncio
async def test_fetch_rag_chunks_returns_empty_on_network_error():
    with patch("orchestration.mlx_coordinator.service_orchestrate.aiohttp.ClientSession",
               side_effect=OSError("connection refused")):
        chunks = await _fetch_rag_chunks("query")
    assert chunks == []


# ---------------------------------------------------------------------------
# POST /api/orchestrate (blocking)
# ---------------------------------------------------------------------------

class TestOrchestrateEndpoint(AioHTTPTestCase):
    async def get_application(self):
        app, self._backend = _make_orchestrate_app(tokens=["merged"])
        return app

    @unittest_run_loop
    async def test_orchestrate_map_reduce_returns_result(self):
        resp = await self.client.post(
            "/api/orchestrate",
            json={
                "mode": "map_reduce",
                "prompt": "summarize",
                "params": {
                    "chunks": ["part one", "part two"],
                    "synthesizer": "synth",
                },
            },
        )
        assert resp.status == 200
        data = await resp.json()
        assert data["mode"] == "map_reduce"
        assert "result" in data
        assert data["meta"]["synthesizer"] == "synth"

    @unittest_run_loop
    async def test_orchestrate_missing_mode_returns_400(self):
        resp = await self.client.post("/api/orchestrate", json={"prompt": "hi"})
        assert resp.status == 400

    @unittest_run_loop
    async def test_orchestrate_missing_prompt_returns_400(self):
        resp = await self.client.post("/api/orchestrate", json={"mode": "map_reduce"})
        assert resp.status == 400

    @unittest_run_loop
    async def test_orchestrate_unknown_mode_returns_400(self):
        resp = await self.client.post(
            "/api/orchestrate",
            json={"mode": "flat", "prompt": "hi"},
        )
        assert resp.status == 400

    @unittest_run_loop
    async def test_orchestrate_memory_guard_returns_503(self):
        with patch(
            "orchestration.mlx_coordinator.service_orchestrate.check_mode_memory_ok",
            return_value=(False, "insufficient host memory"),
        ):
            resp = await self.client.post(
                "/api/orchestrate",
                json={"mode": "map_reduce", "prompt": "hi", "params": {"chunks": ["a"]}},
            )
        assert resp.status == 503

    @unittest_run_loop
    async def test_orchestrate_bad_json_returns_400(self):
        resp = await self.client.post(
            "/api/orchestrate",
            data="not-json",
            headers={"Content-Type": "application/json"},
        )
        assert resp.status == 400

    @unittest_run_loop
    async def test_orchestrate_critic_debate(self):
        self._backend.generate_stream = MagicMock(
            side_effect=[
                _token_stream("answer"),
                _token_stream("SHIP ok"),
            ]
        )
        resp = await self.client.post(
            "/api/orchestrate",
            json={
                "mode": "critic_debate",
                "prompt": "design api",
                "params": {"generator": "gen", "critic": "critic"},
            },
        )
        assert resp.status == 200
        data = await resp.json()
        assert data["meta"]["verdict"] == "SHIP"

    @unittest_run_loop
    async def test_orchestrate_injects_rag_when_use_rag(self):
        rag_chunks = [{"source_path": "d.md", "distance": 0.2, "content": "doc"}]
        with patch(
            "orchestration.mlx_coordinator.service_orchestrate._fetch_rag_chunks",
            new=AsyncMock(return_value=rag_chunks),
        ):
            resp = await self.client.post(
                "/api/orchestrate",
                json={
                    "mode": "map_reduce",
                    "prompt": "q",
                    "use_rag": True,
                    "params": {"chunks": ["c1"], "synthesizer": "synth"},
                },
            )
        assert resp.status == 200
        data = await resp.json()
        assert data["meta"].get("rag_chunks") == rag_chunks


# ---------------------------------------------------------------------------
# POST /api/orchestrate/stream (SSE)
# ---------------------------------------------------------------------------

class TestOrchestrateStreamEndpoint(AioHTTPTestCase):
    async def get_application(self):
        app, self._backend = _make_orchestrate_app(tokens=["tok"])
        return app

    @unittest_run_loop
    async def test_stream_returns_event_stream(self):
        resp = await self.client.post(
            "/api/orchestrate/stream",
            json={
                "mode": "speculative",
                "prompt": "hello",
                "params": {"drafter": "drafter", "verifier": "verifier", "block_size": 3},
            },
        )
        assert resp.status == 200
        assert "text/event-stream" in resp.content_type

    @unittest_run_loop
    async def test_stream_emits_token_and_done(self):
        resp = await self.client.post(
            "/api/orchestrate/stream",
            json={
                "mode": "speculative",
                "prompt": "hello",
                "params": {"drafter": "drafter", "verifier": "verifier", "block_size": 3},
            },
        )
        body = await resp.text()
        assert "event: token" in body
        assert "event: agent_start" in body
        assert "event: done" in body
        done_line = next(l for l in body.split("\n") if l.startswith("data: ") and "result" in l)
        payload = json.loads(done_line[len("data: "):])
        assert payload["mode"] == "speculative"
        assert "session_id" in payload

    @unittest_run_loop
    async def test_stream_missing_mode_returns_400(self):
        resp = await self.client.post(
            "/api/orchestrate/stream",
            json={"prompt": "hi"},
        )
        assert resp.status == 400

    @unittest_run_loop
    async def test_stream_missing_prompt_returns_400(self):
        resp = await self.client.post(
            "/api/orchestrate/stream",
            json={"mode": "map_reduce"},
        )
        assert resp.status == 400

    @unittest_run_loop
    async def test_stream_unknown_mode_returns_400(self):
        resp = await self.client.post(
            "/api/orchestrate/stream",
            json={"mode": "pipeline", "prompt": "hi"},
        )
        assert resp.status == 400

    @unittest_run_loop
    async def test_stream_done_includes_token_timings(self):
        resp = await self.client.post(
            "/api/orchestrate/stream",
            json={
                "mode": "critic_debate",
                "prompt": "q",
                "params": {"generator": "gen", "critic": "critic"},
            },
        )
        body = await resp.text()
        done_data = json.loads(
            next(l for l in body.split("\n") if l.startswith("data: ") and "timings" in l)[len("data: "):]
        )
        assert "timings" in done_data["meta"]
        for agent_id, timing in done_data["meta"]["timings"].items():
            assert "completion_tokens" in timing
            assert timing["total_ms"] == 0
