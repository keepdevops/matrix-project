"""Advanced MlxBackend tests — SSE parsing edge cases, concurrent inflight, malformed data."""
import asyncio
import json
import pytest
from unittest.mock import AsyncMock, MagicMock

from backends.base import GenerateRequest, TokenChunk
from orchestration.mlx_coordinator.backend import MlxBackend, _inflight, get_pressure


def _reset():
    _inflight.clear()


def _new_loop():
    return asyncio.new_event_loop()


class _FakeContent:
    """Async-iterable over pre-built SSE byte lines."""
    def __init__(self, lines: list[bytes]):
        self._lines = lines

    def __aiter__(self):
        return self._gen()

    async def _gen(self):
        for line in self._lines:
            yield line


def _resp(status: int, lines: list[bytes]) -> MagicMock:
    r = MagicMock()
    r.status = status
    r.content = _FakeContent(lines)
    return r


def _sse(token: str) -> bytes:
    data = {"choices": [{"delta": {"content": token}}]}
    return f"data: {json.dumps(data)}\n\n".encode()


def _done() -> bytes:
    return b"data: [DONE]\n\n"


def _ctx(resp):
    m = MagicMock()
    m.__aenter__ = AsyncMock(return_value=resp)
    m.__aexit__ = AsyncMock(return_value=False)
    return m


def _backend(**kw) -> MlxBackend:
    b = MlxBackend(port=8083, agent_id="scout", **kw)
    return b


def _stream(b, lines, status=200):
    resp = _resp(status, lines)
    session = MagicMock()
    session.post = MagicMock(return_value=_ctx(resp))
    b._get_session = MagicMock(return_value=session)

    async def run():
        chunks = []
        async for chunk in b.generate_stream(GenerateRequest(prompt="test")):
            chunks.append(chunk)
        return chunks

    loop = _new_loop()
    try:
        return loop.run_until_complete(run())
    finally:
        loop.close()


# ---------------------------------------------------------------------------
# SSE parsing edge cases
# ---------------------------------------------------------------------------

def test_empty_lines_are_skipped():
    _reset()
    b = _backend()
    lines = [b"\n", b"\n", _sse("hi"), b"\n", _done()]
    chunks = _stream(b, lines)
    assert any(c.text == "hi" for c in chunks)


def test_non_data_lines_are_skipped():
    _reset()
    b = _backend()
    lines = [b"comment: ignored\n\n", _sse("ok"), _done()]
    chunks = _stream(b, lines)
    assert any(c.text == "ok" for c in chunks)


def test_malformed_json_line_is_skipped():
    _reset()
    b = _backend()
    lines = [b"data: {not json}\n\n", _sse("good"), _done()]
    chunks = _stream(b, lines)
    texts = [c.text for c in chunks if c.text]
    assert "good" in texts


def test_delta_without_content_key_yields_nothing():
    _reset()
    b = _backend()
    no_content = {"choices": [{"delta": {}}]}
    lines = [f"data: {json.dumps(no_content)}\n\n".encode(), _done()]
    chunks = _stream(b, lines)
    texts = [c.text for c in chunks if c.text]
    assert texts == []


def test_empty_delta_content_yields_nothing():
    _reset()
    b = _backend()
    empty = {"choices": [{"delta": {"content": ""}}]}
    lines = [f"data: {json.dumps(empty)}\n\n".encode(), _done()]
    chunks = _stream(b, lines)
    texts = [c.text for c in chunks if c.text]
    assert texts == []


def test_multiple_tokens_in_order():
    _reset()
    b = _backend()
    tokens = ["The", " quick", " brown", " fox"]
    lines = [_sse(t) for t in tokens] + [_done()]
    chunks = _stream(b, lines)
    texts = [c.text for c in chunks if c.text]
    assert texts == tokens


def test_final_chunk_has_done_true():
    _reset()
    b = _backend()
    chunks = _stream(b, [_sse("x"), _done()])
    assert chunks[-1].done is True


def test_unicode_tokens_pass_through():
    _reset()
    b = _backend()
    token = "héllo wörld 🌍"
    chunks = _stream(b, [_sse(token), _done()])
    texts = [c.text for c in chunks if c.text]
    assert token in texts


def test_large_token_batch():
    _reset()
    b = _backend()
    tokens = [f"tok{i}" for i in range(200)]
    lines = [_sse(t) for t in tokens] + [_done()]
    chunks = _stream(b, lines)
    texts = [c.text for c in chunks if c.text]
    assert texts == tokens


# ---------------------------------------------------------------------------
# system_prompt variants
# ---------------------------------------------------------------------------

def test_system_prompt_separator():
    b = _backend(system_prompt="Be helpful.")
    msgs = b._build_messages("What is 2+2?")
    content = msgs[0]["content"]
    assert content.index("Be helpful.") < content.index("What is 2+2?")


def test_system_prompt_whitespace_only_treated_as_empty():
    b = _backend(system_prompt="   ")
    msgs = b._build_messages("Hello")
    # whitespace-only system_prompt is truthy so it gets prepended
    assert len(msgs) == 1
    assert msgs[0]["role"] == "user"


def test_empty_prompt_still_builds_message():
    b = _backend(system_prompt="")
    msgs = b._build_messages("")
    assert msgs == [{"role": "user", "content": ""}]


# ---------------------------------------------------------------------------
# stop sequences are forwarded
# ---------------------------------------------------------------------------

def test_stop_sequences_in_payload():
    _reset()
    b = _backend()
    captured = {}

    async def run():
        session = MagicMock()

        def fake_post(url, json=None, **kw):
            captured["payload"] = json
            resp = _resp(200, [_done()])
            return _ctx(resp)

        session.post = MagicMock(side_effect=fake_post)
        b._get_session = MagicMock(return_value=session)
        async for _ in b.generate_stream(GenerateRequest(prompt="hi", stop=["</s>", "\n"])):
            pass

    _new_loop().run_until_complete(run())
    assert captured["payload"]["stop"] == ["</s>", "\n"]


def test_no_stop_key_when_stop_empty():
    _reset()
    b = _backend()
    captured = {}

    async def run():
        session = MagicMock()

        def fake_post(url, json=None, **kw):
            captured["payload"] = json
            return _ctx(_resp(200, [_done()]))

        session.post = MagicMock(side_effect=fake_post)
        b._get_session = MagicMock(return_value=session)
        async for _ in b.generate_stream(GenerateRequest(prompt="hi")):
            pass

    _new_loop().run_until_complete(run())
    assert "stop" not in captured["payload"]


# ---------------------------------------------------------------------------
# Inflight pressure — concurrent requests on same port
# ---------------------------------------------------------------------------

def test_inflight_multiple_ports_independent():
    _reset()
    from orchestration.mlx_coordinator.backend import _inc, _dec

    async def run():
        await _inc(8082)
        await _inc(8083)
        await _inc(8083)
        p = get_pressure()
        await _dec(8082)
        await _dec(8083)
        await _dec(8083)
        return p

    p = _new_loop().run_until_complete(run())
    assert p[8082] == 1
    assert p[8083] == 2


def test_inflight_decremented_even_on_http_error():
    _reset()
    b = _backend()
    bad = _resp(503, [])
    bad.text = AsyncMock(return_value="error")
    session = MagicMock()
    session.post = MagicMock(return_value=_ctx(bad))
    b._get_session = MagicMock(return_value=session)

    async def run():
        async for _ in b.generate_stream(GenerateRequest(prompt="hi")):
            pass
        return get_pressure()

    pressure = _new_loop().run_until_complete(run())
    assert pressure.get(8083, 0) == 0


def test_inflight_decremented_even_on_connection_error():
    _reset()
    import aiohttp
    b = _backend()
    session = MagicMock()
    session.post = MagicMock(side_effect=aiohttp.ClientConnectionError("refused"))
    b._get_session = MagicMock(return_value=session)

    async def run():
        async for _ in b.generate_stream(GenerateRequest(prompt="hi")):
            pass
        return get_pressure()

    pressure = _new_loop().run_until_complete(run())
    assert pressure.get(8083, 0) == 0
