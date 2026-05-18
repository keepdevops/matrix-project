"""Tests for MlxBackend — message building, streaming, health check, inflight tracking."""
import asyncio
import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from backends.base import GenerateRequest, HealthStatus
from orchestration.mlx_coordinator.backend import MlxBackend, get_pressure, _inflight


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def _reset_inflight():
    _inflight.clear()


# ---------------------------------------------------------------------------
# _build_messages
# ---------------------------------------------------------------------------

def test_build_messages_merges_system_prompt():
    b = MlxBackend(port=8083, agent_id="scout", system_prompt="Be concise.")
    msgs = b._build_messages("What is X?")
    assert len(msgs) == 1
    assert msgs[0]["role"] == "user"
    assert "Be concise." in msgs[0]["content"]
    assert "What is X?" in msgs[0]["content"]


def test_build_messages_no_system_prompt():
    b = MlxBackend(port=8083, agent_id="scout", system_prompt="")
    msgs = b._build_messages("Hello")
    assert msgs == [{"role": "user", "content": "Hello"}]


def test_build_messages_no_system_role():
    b = MlxBackend(port=8083, agent_id="scout", system_prompt="Sys.")
    msgs = b._build_messages("Q")
    roles = [m["role"] for m in msgs]
    assert "system" not in roles


# ---------------------------------------------------------------------------
# generate_stream — happy path
# ---------------------------------------------------------------------------

def _make_sse_response(tokens: list[str]) -> bytes:
    lines = []
    for t in tokens:
        data = {"choices": [{"delta": {"content": t}}]}
        lines.append(f"data: {json.dumps(data)}\n\n".encode())
    lines.append(b"data: [DONE]\n\n")
    return b"".join(lines)


def _mock_stream_response(tokens: list[str]):
    """Returns an aiohttp response mock that streams SSE tokens."""
    chunks = []
    for t in tokens:
        data = {"choices": [{"delta": {"content": t}}]}
        chunks.append(f"data: {json.dumps(data)}\n\n".encode())
    chunks.append(b"data: [DONE]\n\n")

    class _FakeContent:
        def __aiter__(self):
            return self._gen()
        async def _gen(self):
            for c in chunks:
                yield c

    resp = MagicMock()
    resp.status = 200
    resp.content = _FakeContent()
    return resp


def test_generate_stream_yields_tokens():
    _reset_inflight()
    b = MlxBackend(port=8083, agent_id="scout", system_prompt="")

    async def run():
        ctx_mgr = MagicMock()
        ctx_mgr.__aenter__ = AsyncMock(return_value=_mock_stream_response(["Hello", " world"]))
        ctx_mgr.__aexit__ = AsyncMock(return_value=False)

        session = MagicMock()
        session.post = MagicMock(return_value=ctx_mgr)
        b._get_session = MagicMock(return_value=session)

        chunks = []
        async for chunk in b.generate_stream(GenerateRequest(prompt="hi")):
            chunks.append(chunk)
        return chunks

    chunks = asyncio.new_event_loop().run_until_complete(run())
    texts = [c.text for c in chunks if c.text]
    assert "Hello" in texts
    assert " world" in texts
    assert chunks[-1].done is True


def test_generate_stream_http_error_yields_error_token():
    _reset_inflight()
    b = MlxBackend(port=8083, agent_id="scout", system_prompt="")

    async def run():
        ctx_mgr = MagicMock()
        bad_resp = MagicMock()
        bad_resp.status = 503
        bad_resp.text = AsyncMock(return_value="overloaded")
        ctx_mgr.__aenter__ = AsyncMock(return_value=bad_resp)
        ctx_mgr.__aexit__ = AsyncMock(return_value=False)

        session = MagicMock()
        session.post = MagicMock(return_value=ctx_mgr)
        b._get_session = MagicMock(return_value=session)

        chunks = []
        async for chunk in b.generate_stream(GenerateRequest(prompt="hi")):
            chunks.append(chunk)
        return chunks

    chunks = asyncio.new_event_loop().run_until_complete(run())
    assert any("503" in c.text for c in chunks)
    assert chunks[-1].done is True


# ---------------------------------------------------------------------------
# health
# ---------------------------------------------------------------------------

def test_health_ok_on_200():
    b = MlxBackend(port=8083, agent_id="scout")

    async def run():
        ctx_mgr = MagicMock()
        resp = MagicMock()
        resp.status = 200
        ctx_mgr.__aenter__ = AsyncMock(return_value=resp)
        ctx_mgr.__aexit__ = AsyncMock(return_value=False)

        session = MagicMock()
        session.get = MagicMock(return_value=ctx_mgr)
        b._get_session = MagicMock(return_value=session)
        return await b.health()

    hs = asyncio.new_event_loop().run_until_complete(run())
    assert hs.ok is True
    assert "8083" in hs.detail


def test_health_fail_on_non_200():
    b = MlxBackend(port=8083, agent_id="scout")

    async def run():
        ctx_mgr = MagicMock()
        resp = MagicMock()
        resp.status = 503
        ctx_mgr.__aenter__ = AsyncMock(return_value=resp)
        ctx_mgr.__aexit__ = AsyncMock(return_value=False)

        session = MagicMock()
        session.get = MagicMock(return_value=ctx_mgr)
        b._get_session = MagicMock(return_value=session)
        return await b.health()

    hs = asyncio.new_event_loop().run_until_complete(run())
    assert hs.ok is False


def test_health_fail_on_connection_error():
    b = MlxBackend(port=8083, agent_id="scout")

    async def run():
        import aiohttp
        session = MagicMock()
        session.get = MagicMock(side_effect=aiohttp.ClientConnectionError("refused"))
        b._get_session = MagicMock(return_value=session)
        return await b.health()

    hs = asyncio.new_event_loop().run_until_complete(run())
    assert hs.ok is False
    assert "refused" in hs.detail


# ---------------------------------------------------------------------------
# embed — must raise NotImplementedError
# ---------------------------------------------------------------------------

def test_embed_raises():
    b = MlxBackend(port=8083, agent_id="scout")
    with pytest.raises(NotImplementedError):
        _run(b.embed(["text"]))


# ---------------------------------------------------------------------------
# inflight pressure tracking
# ---------------------------------------------------------------------------

def test_inflight_increments_and_decrements():
    _reset_inflight()
    from orchestration.mlx_coordinator.backend import _inc, _dec, get_pressure

    async def run():
        await _inc(8083)
        await _inc(8083)
        mid = get_pressure()
        await _dec(8083)
        end = get_pressure()
        return mid, end

    mid, end = asyncio.new_event_loop().run_until_complete(run())
    assert mid.get(8083) == 2
    assert end.get(8083) == 1


def test_inflight_never_goes_below_zero():
    _reset_inflight()
    from orchestration.mlx_coordinator.backend import _dec, get_pressure

    async def run():
        await _dec(9999)
        return get_pressure()

    pressure = asyncio.new_event_loop().run_until_complete(run())
    assert pressure.get(9999, 0) == 0
