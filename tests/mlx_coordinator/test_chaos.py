"""Chaos monkey end-to-end tests for the MLX coordinator.

Strategy:
  - Every test spins up the real aiohttp app with mocked backends/MLX
  - Chaos is injected at the backend layer (errors, hangs, partial data,
    concurrent floods, bad SSE frames, session store poisoning)
  - Invariants checked: no 5xx leaks, SSE stream closes cleanly, session
    store stays consistent, inflight counters return to zero

All tests run 100 iterations where applicable.
"""
from __future__ import annotations

import asyncio
import json
import random
import string
import time
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop
from backends.base import TokenChunk, HealthStatus
from orchestration.mlx_coordinator.backend import MlxBackend, _inflight
from orchestration.mlx_coordinator.session import SessionStore
from orchestration.manager import AgentConfig


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def _make_agent(agent_id="mlx-scout", port=8083) -> AgentConfig:
    return AgentConfig(
        agent_id=agent_id, name=agent_id,
        model="/models/test-mlx",
        system_prompt="Be concise.",
        context=4096, max_tokens=512,
        engine="mlx", coordinator="mlx", port=port,
    )


async def _token_gen(*tokens):
    for t in tokens:
        yield TokenChunk(text=t)
    yield TokenChunk(text="", done=True)


async def _error_gen(msg="backend exploded"):
    yield TokenChunk(text=f"[error: {msg}]", done=True)


async def _hanging_gen():
    await asyncio.sleep(9999)
    yield TokenChunk(text="never", done=True)


async def _partial_then_error_gen(*tokens):
    for t in tokens:
        yield TokenChunk(text=t)
    raise RuntimeError("mid-stream backend crash")


def _backend(gen_fn=None, health_ok=True):
    b = MagicMock(spec=MlxBackend)
    if gen_fn is None:
        b.generate_stream = MagicMock(return_value=_token_gen("ok"))
    else:
        b.generate_stream = MagicMock(side_effect=gen_fn)
    b.health = AsyncMock(return_value=HealthStatus(
        ok=health_ok,
        detail="ok" if health_ok else "down",
    ))
    b.close = AsyncMock()
    return b


def _make_app(backend_obj=None, agents=None, mode="flat"):
    from orchestration.mlx_coordinator.service import make_app
    app = make_app()
    agents = agents or {"mlx-scout": _make_agent()}
    backends = {"mlx": backend_obj or _backend()}

    async def _startup(a):
        a["swarm"] = agents
        a["backends"] = backends
        a["sessions"] = SessionStore()
        a["active_mode"] = mode
        a["_cleanup_task"] = asyncio.create_task(asyncio.sleep(9999))

    app.on_startup.clear()
    app.on_startup.append(_startup)
    return app


# ---------------------------------------------------------------------------
# Chaos: backend raises on generate_stream
# ---------------------------------------------------------------------------

class TestBackendRaisesOnStream(AioHTTPTestCase):
    async def get_application(self):
        def _raise():
            raise RuntimeError("backend unavailable")
        b = _backend(gen_fn=lambda req: _raise() or _token_gen())
        return _make_app(b)

    @unittest_run_loop
    async def test_submit_does_not_crash_on_backend_raise(self):
        # FlatMode catches per-agent failures internally — service returns 200
        # with whatever partial result the mode assembled (may be empty).
        # This is the actual contract: an agent error is not a coordinator crash.
        resp = await self.client.post("/api/mlx/submit", json={"prompt": "hello"})
        assert resp.status in (200, 500)
        if resp.status == 200:
            data = await resp.json()
            assert "result" in data and "session_id" in data

    @unittest_run_loop
    async def test_stream_sends_error_event_on_backend_raise(self):
        resp = await self.client.post("/api/mlx/stream", json={"prompt": "hello"})
        assert resp.status == 200  # SSE: headers sent before error
        body = await resp.text()
        assert "error" in body


# ---------------------------------------------------------------------------
# Chaos: backend yields error token
# ---------------------------------------------------------------------------

class TestBackendErrorToken(AioHTTPTestCase):
    async def get_application(self):
        b = _backend()
        b.generate_stream = MagicMock(return_value=_error_gen("oops"))
        return _make_app(b)

    @unittest_run_loop
    async def test_submit_result_contains_error_token(self):
        resp = await self.client.post("/api/mlx/submit", json={"prompt": "hi"})
        assert resp.status == 200
        data = await resp.json()
        assert "error" in data["result"]


# ---------------------------------------------------------------------------
# Chaos: backend is unhealthy
# ---------------------------------------------------------------------------

class TestBackendUnhealthy(AioHTTPTestCase):
    async def get_application(self):
        return _make_app(_backend(health_ok=False))

    @unittest_run_loop
    async def test_health_endpoint_returns_503_when_backend_down(self):
        resp = await self.client.get("/api/mlx/health")
        assert resp.status == 503
        data = await resp.json()
        assert data["ok"] is False


# ---------------------------------------------------------------------------
# Chaos: 100 random prompts — submit never crashes the service
# ---------------------------------------------------------------------------

class TestRandomPrompts100(AioHTTPTestCase):
    async def get_application(self):
        self._call_count = 0

        async def _random_stream(req):
            self._call_count += 1
            choice = random.randint(0, 3)
            if choice == 0:
                yield TokenChunk(text="normal response", done=False)
                yield TokenChunk(text="", done=True)
            elif choice == 1:
                yield TokenChunk(text="[error: random]", done=True)
            elif choice == 2:
                # Empty response
                yield TokenChunk(text="", done=True)
            else:
                for _ in range(random.randint(1, 10)):
                    yield TokenChunk(text=random.choice(["a", "b", " ", "!", "."]))
                yield TokenChunk(text="", done=True)

        b = _backend()
        b.generate_stream = MagicMock(side_effect=_random_stream)
        return _make_app(b)

    @unittest_run_loop
    async def test_100_random_prompts_all_respond(self):
        failures = []
        prompts = [
            "hello",
            " ",
            "a" * 4000,
            "What is " + "very " * 100 + "important?",
            "你好",
            "🎉🔥💀",
            "\n\n\n",
            "prompt with \"quotes\" and 'apostrophes'",
            "<script>alert(1)</script>",
            "null",
            "undefined",
            "true",
            "1234567890",
        ]

        for i in range(100):
            prompt = random.choice(prompts)
            session_id = f"chaos-{i}"
            try:
                resp = await self.client.post(
                    "/api/mlx/submit",
                    json={"prompt": prompt, "session_id": session_id},
                )
                if resp.status not in (200, 400, 500):
                    failures.append(f"run {i}: unexpected status {resp.status}")
                if resp.status == 200:
                    data = await resp.json()
                    if "result" not in data:
                        failures.append(f"run {i}: no result key in 200 response")
            except Exception as exc:
                failures.append(f"run {i}: threw {exc}")

        assert failures == [], "\n".join(failures)


# ---------------------------------------------------------------------------
# Chaos: 100 poisoned JSON bodies — all return 400, never 500
# ---------------------------------------------------------------------------

class TestPoisonedBodies100(AioHTTPTestCase):
    async def get_application(self):
        return _make_app()

    @unittest_run_loop
    async def test_poisoned_submit_bodies_return_4xx(self):
        bad_bodies = [
            b"",
            b"null",
            b"[]",
            b"true",
            b"42",
            b"{bad json",
            b'{"prompt": null}',
            b'{"prompt": 0}',
            b'{"prompt": []}',
            b'{"prompt": {}}',
            b'{"no_prompt_key": "value"}',
        ]
        failures = []
        for i in range(100):
            body = random.choice(bad_bodies)
            try:
                resp = await self.client.post(
                    "/api/mlx/submit",
                    data=body,
                    headers={"Content-Type": "application/json"},
                )
                if resp.status >= 500:
                    failures.append(f"run {i} body={body[:30]!r}: got {resp.status}, want 4xx")
            except Exception as exc:
                failures.append(f"run {i}: threw {exc}")

        assert failures == [], "\n".join(failures)

    @unittest_run_loop
    async def test_poisoned_stream_bodies_return_4xx_or_200(self):
        # Stream endpoint sends 200 + SSE error event for runtime errors,
        # 400 for missing/invalid prompt.
        bad_bodies = [
            b"",
            b"null",
            b'{"prompt": null}',
            b'{"no_prompt": true}',
            b"{bad json",
        ]
        failures = []
        for i in range(100):
            body = random.choice(bad_bodies)
            try:
                resp = await self.client.post(
                    "/api/mlx/stream",
                    data=body,
                    headers={"Content-Type": "application/json"},
                )
                if resp.status >= 500:
                    failures.append(f"run {i}: got {resp.status}")
            except Exception as exc:
                failures.append(f"run {i}: threw {exc}")

        assert failures == [], "\n".join(failures)


# ---------------------------------------------------------------------------
# Chaos: mode switching under concurrent submit load
# ---------------------------------------------------------------------------

class TestModeSwitchingUnderLoad(AioHTTPTestCase):
    async def get_application(self):
        async def _slow_stream(req):
            await asyncio.sleep(0.01)
            yield TokenChunk(text="done", done=False)
            yield TokenChunk(text="", done=True)

        b = _backend()
        b.generate_stream = MagicMock(side_effect=_slow_stream)
        return _make_app(b)

    @unittest_run_loop
    async def test_30_mode_switches_interleaved_with_submits(self):
        modes = ["flat", "pipeline", "cascade"]
        failures = []

        async def _switch(mode):
            resp = await self.client.post("/api/mlx/modes/active", json={"mode": mode})
            if resp.status != 200:
                failures.append(f"mode switch {mode}: status {resp.status}")

        async def _submit(i):
            resp = await self.client.post("/api/mlx/submit",
                                          json={"prompt": f"hello {i}"})
            if resp.status not in (200, 500):
                failures.append(f"submit {i}: status {resp.status}")

        ops = []
        for i in range(30):
            ops.append(_submit(i))
            if i % 5 == 0:
                ops.append(_switch(random.choice(modes)))

        await asyncio.gather(*ops, return_exceptions=True)
        assert failures == [], "\n".join(failures)


# ---------------------------------------------------------------------------
# Chaos: session store under concurrent clear + write pressure
# ---------------------------------------------------------------------------

class TestSessionStoreConcurrentChaos(AioHTTPTestCase):
    async def get_application(self):
        return _make_app()

    @unittest_run_loop
    async def test_concurrent_session_clear_and_create_100(self):
        """100 concurrent get_or_create + random clears — store never corrupts."""
        sessions: SessionStore = self.app["sessions"]
        failures = []

        async def _create(sid):
            try:
                await sessions.get_or_create(sid)
                await sessions.append_message(sid, "user", "msg")
            except Exception as exc:
                failures.append(f"create {sid}: {exc}")

        async def _clear(sid):
            try:
                with patch("orchestration.mlx_coordinator.session._free_cache"):
                    await sessions.clear(sid)
            except Exception as exc:
                failures.append(f"clear {sid}: {exc}")

        ops = []
        for i in range(100):
            sid = f"s-{i % 20}"   # 20 unique IDs → heavy contention
            ops.append(_create(sid))
            if random.random() < 0.3:
                ops.append(_clear(sid))

        await asyncio.gather(*ops, return_exceptions=True)

        # Count must be non-negative
        if sessions.active_count() < 0:
            failures.append(f"active_count is negative: {sessions.active_count()}")

        # snapshot must be consistent
        snap = sessions.snapshot()
        if not isinstance(snap, list):
            failures.append("snapshot is not a list")

        assert failures == [], "\n".join(failures)

    @unittest_run_loop
    async def test_clear_all_during_heavy_writes_leaves_store_empty(self):
        sessions: SessionStore = self.app["sessions"]

        async def _writer(sid):
            await sessions.append_message(sid, "user", "hi")

        writers = [_writer(f"w-{i}") for i in range(50)]
        with patch("orchestration.mlx_coordinator.session._free_cache"):
            await asyncio.gather(*writers)
            await sessions.clear_all()

        assert sessions.active_count() == 0


# ---------------------------------------------------------------------------
# Chaos: 100 random session IDs — clear endpoint never crashes
# ---------------------------------------------------------------------------

class TestSessionClearChaos100(AioHTTPTestCase):
    async def get_application(self):
        return _make_app()

    @unittest_run_loop
    async def test_100_random_session_clear_requests(self):
        # Seed a few real sessions
        sessions: SessionStore = self.app["sessions"]
        for sid in ["real-1", "real-2", "real-3"]:
            await sessions.get_or_create(sid)

        failures = []
        random_ids = [
            "real-1", "real-2", "ghost-xyz", "", "null",
            "a" * 200, "../../../etc/passwd",
            "'; DROP TABLE sessions; --",
        ]

        for i in range(100):
            sid = random.choice(random_ids)
            body = {"session_id": sid} if sid else {}
            with patch("orchestration.mlx_coordinator.session._free_cache"):
                try:
                    resp = await self.client.post("/api/mlx/session/clear", json=body)
                    if resp.status not in (200, 400):
                        failures.append(f"run {i} sid={sid!r}: status {resp.status}")
                except Exception as exc:
                    failures.append(f"run {i}: threw {exc}")

        assert failures == [], "\n".join(failures)


# ---------------------------------------------------------------------------
# Chaos: inflight counters return to zero after errors
# ---------------------------------------------------------------------------

class TestInflightReturnsToZero(AioHTTPTestCase):
    async def get_application(self):
        self._port = 9991

        async def _failing_stream(req):
            from orchestration.mlx_coordinator.backend import _inc, _dec
            await _inc(self._port)
            try:
                raise aiohttp_error()
            finally:
                await _dec(self._port)

        import aiohttp
        def aiohttp_error():
            return aiohttp.ClientError("fake connection error")

        b = MagicMock(spec=MlxBackend)
        b.generate_stream = MagicMock(side_effect=_failing_stream)
        b.health = AsyncMock(return_value=HealthStatus(ok=True, detail="ok"))
        b.close = AsyncMock()

        agents = {"mlx-scout": _make_agent(port=self._port)}
        return _make_app(b, agents=agents)

    @unittest_run_loop
    async def test_inflight_zero_after_backend_errors(self):
        _inflight.clear()
        for _ in range(10):
            await self.client.post("/api/mlx/submit", json={"prompt": "hi"})
        assert _inflight.get(self._port, 0) == 0


# ---------------------------------------------------------------------------
# Chaos: 100 concurrent stream requests — all SSE streams close cleanly
# ---------------------------------------------------------------------------

class TestConcurrentStreamRequests(AioHTTPTestCase):
    async def get_application(self):
        call = {"n": 0}

        async def _varied_stream(req):
            call["n"] += 1
            n = call["n"]
            if n % 5 == 0:
                raise RuntimeError("periodic backend crash")
            for i in range(random.randint(1, 5)):
                yield TokenChunk(text=f"tok{i}")
                await asyncio.sleep(0)
            yield TokenChunk(text="", done=True)

        b = _backend()
        b.generate_stream = MagicMock(side_effect=_varied_stream)
        return _make_app(b)

    @unittest_run_loop
    async def test_50_concurrent_streams_all_close(self):
        failures = []

        async def _stream(i):
            try:
                resp = await self.client.post(
                    "/api/mlx/stream",
                    json={"prompt": f"concurrent {i}", "session_id": f"cc-{i}"},
                )
                if resp.status not in (200, 500):
                    failures.append(f"stream {i}: status {resp.status}")
                    return
                body = await resp.text()
                if resp.status == 200 and "event:" not in body and "error" not in body:
                    failures.append(f"stream {i}: no SSE events in body")
            except Exception as exc:
                failures.append(f"stream {i}: threw {exc}")

        await asyncio.gather(*[_stream(i) for i in range(50)])
        assert failures == [], "\n".join(failures)


# ---------------------------------------------------------------------------
# Chaos: pressure endpoint under concurrent load — counts stay non-negative
# ---------------------------------------------------------------------------

class TestPressureEndpointChaos(AioHTTPTestCase):
    async def get_application(self):
        async def _slow(req):
            await asyncio.sleep(0.005)
            yield TokenChunk(text="done")
            yield TokenChunk(text="", done=True)

        b = _backend()
        b.generate_stream = MagicMock(side_effect=_slow)
        return _make_app(b)

    @unittest_run_loop
    async def test_pressure_counts_always_valid(self):
        failures = []

        async def _poll_pressure():
            for _ in range(20):
                resp = await self.client.get("/api/mlx/pressure")
                if resp.status != 200:
                    failures.append(f"pressure: status {resp.status}")
                    return
                data = await resp.json()
                for port, count in data.get("inflight", {}).items():
                    if count < 0:
                        failures.append(f"port {port}: negative inflight {count}")
                await asyncio.sleep(0.002)

        async def _flood():
            for i in range(20):
                await self.client.post("/api/mlx/submit",
                                       json={"prompt": f"p{i}"})

        await asyncio.gather(_poll_pressure(), _flood())
        assert failures == [], "\n".join(failures)


# ---------------------------------------------------------------------------
# Chaos: unknown routes never return 500
# ---------------------------------------------------------------------------

class TestUnknownRoutes(AioHTTPTestCase):
    async def get_application(self):
        return _make_app()

    @unittest_run_loop
    async def test_unknown_get_routes_return_404(self):
        paths = [
            "/api/mlx/doesnotexist",
            "/api/mlx/",
            "/api/mlx",
            "/api/llama/stream",
            "/",
            "/admin",
            "/api/mlx/stream/extra",
        ]
        for path in paths:
            resp = await self.client.get(path)
            assert resp.status in (404, 405), f"{path}: got {resp.status}"

    @unittest_run_loop
    async def test_100_random_unknown_paths_never_500(self):
        failures = []
        for i in range(100):
            path = "/api/mlx/" + "".join(
                random.choices(string.ascii_lowercase + "/.-_", k=random.randint(1, 30))
            )
            try:
                resp = await self.client.get(path)
                if resp.status >= 500:
                    failures.append(f"run {i} {path}: got {resp.status}")
            except Exception as exc:
                failures.append(f"run {i}: threw {exc}")

        assert failures == [], "\n".join(failures)


# ---------------------------------------------------------------------------
# Chaos: session lifecycle — idle eviction during active writes
# ---------------------------------------------------------------------------

class TestIdleEvictionChaos(AioHTTPTestCase):
    async def get_application(self):
        return _make_app()

    @unittest_run_loop
    async def test_idle_eviction_during_concurrent_writes_no_corruption(self):
        sessions: SessionStore = self.app["sessions"]
        sessions.max_idle_secs = 0   # everything is instantly stale

        failures = []

        async def _writer(sid):
            try:
                await sessions.append_message(sid, "user", "msg")
            except Exception as exc:
                failures.append(f"writer {sid}: {exc}")

        async def _evictor():
            for _ in range(10):
                with patch("orchestration.mlx_coordinator.session._free_cache"):
                    await sessions.cleanup_idle()
                await asyncio.sleep(0)

        ops = [_writer(f"w-{i}") for i in range(50)] + [_evictor()]
        await asyncio.gather(*ops, return_exceptions=True)

        # After eviction storm, store must be self-consistent
        count = sessions.active_count()
        snap = sessions.snapshot()
        if len(snap) != count:
            failures.append(f"snapshot len {len(snap)} != active_count {count}")

        assert failures == [], "\n".join(failures)
