"""100-run stability test: generate_stream across varied prompts and token shapes."""
import asyncio
import json
import random
import string
from unittest.mock import AsyncMock, MagicMock

import pytest

from backends.base import GenerateRequest, TokenChunk
from orchestration.mlx_coordinator.backend import MlxBackend, _inflight


def _reset():
    _inflight.clear()


class _FakeContent:
    def __init__(self, lines):
        self._lines = lines

    def __aiter__(self):
        return self._gen()

    async def _gen(self):
        for line in self._lines:
            yield line


def _sse(token: str) -> bytes:
    return f"data: {json.dumps({'choices': [{'delta': {'content': token}}]})}\n\n".encode()


def _done() -> bytes:
    return b"data: [DONE]\n\n"


def _ctx(resp):
    m = MagicMock()
    m.__aenter__ = AsyncMock(return_value=resp)
    m.__aexit__ = AsyncMock(return_value=False)
    return m


def _mock_resp(tokens):
    resp = MagicMock()
    resp.status = 200
    resp.content = _FakeContent([_sse(t) for t in tokens] + [_done()])
    return resp


def _stream_tokens(b: MlxBackend, prompt: str, tokens: list) -> list:
    resp = _mock_resp(tokens)
    session = MagicMock()
    session.post = MagicMock(return_value=_ctx(resp))
    b._get_session = MagicMock(return_value=session)

    async def run():
        out = []
        async for chunk in b.generate_stream(GenerateRequest(prompt=prompt)):
            out.append(chunk)
        return out

    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(run())
    finally:
        loop.close()


PROMPT_FIXTURES = [
    ("simple", ["Hello", " world"]),
    ("empty_response", []),
    ("single_token", ["X"]),
    ("long_response", [f"tok{i}" for i in range(50)]),
    ("unicode", ["héllo", " wörld", " 🌍"]),
    ("newlines", ["line1\n", "line2\n", "line3\n"]),
    ("code_snippet", ["def", " foo", "(", "x", "):", "\n", "    return", " x"]),
    ("numbers", ["1", "2", "3", "4", "5"]),
    ("punctuation", ["...", "!", "?", ";", ":"]),
    ("mixed_lengths", ["a", "ab", "abc", "abcd", "abcde"]),
]

PROMPTS = [
    "What is the capital of France?",
    "Write a Python function to reverse a string.",
    "Explain quantum entanglement in one sentence.",
    "",  # empty prompt (valid content but stripped by service layer)
    "   ",
    "a" * 1000,  # very long
    "🚀 launch in 3... 2... 1...",
    "SELECT * FROM users WHERE id = 1;",
    "\n\n\n",
    "short",
]


@pytest.mark.parametrize("label,tokens", PROMPT_FIXTURES)
def test_generate_stream_token_fixtures(label, tokens):
    _reset()
    b = MlxBackend(port=8083, agent_id="test")
    chunks = _stream_tokens(b, "test prompt", tokens)
    texts = [c.text for c in chunks if c.text]
    assert texts == tokens
    assert chunks[-1].done is True


@pytest.mark.parametrize("prompt", PROMPTS)
def test_generate_stream_varied_prompts(prompt):
    _reset()
    b = MlxBackend(port=8083, agent_id="test", system_prompt="Sys.")
    tokens = ["response", " to", " prompt"]
    chunks = _stream_tokens(b, prompt, tokens)
    texts = [c.text for c in chunks if c.text]
    assert texts == tokens
    assert chunks[-1].done is True


def test_generate_stream_100_random_prompts():
    """Drive generate_stream with 100 random prompts and token sets."""
    _reset()

    def _rand_tokens(n: int) -> list[str]:
        return [
            "".join(random.choices(string.ascii_letters + " ", k=random.randint(1, 8)))
            for _ in range(n)
        ]

    def _rand_prompt() -> str:
        length = random.randint(0, 200)
        return "".join(random.choices(string.printable, k=length))

    failures = []
    for i in range(100):
        b = MlxBackend(port=8083, agent_id=f"agent-{i}")
        prompt = _rand_prompt()
        tokens = _rand_tokens(random.randint(0, 30))
        try:
            chunks = _stream_tokens(b, prompt, tokens)
            texts = [c.text for c in chunks if c.text]
            assert texts == tokens, f"run {i}: expected {tokens!r}, got {texts!r}"
            assert chunks[-1].done is True, f"run {i}: last chunk not done"
        except Exception as exc:
            short = repr(prompt)[:40]
            failures.append(f"run {i} (prompt={short}, tokens={len(tokens)}): {exc}")

    assert not failures, "\n".join(failures)


def test_generate_stream_100_concurrent_backends():
    """100 backends running concurrently — all complete, inflight returns to zero."""
    _reset()

    async def one_stream(i: int):
        b = MlxBackend(port=8090 + (i % 4), agent_id=f"a{i}")
        tokens = [f"t{j}" for j in range(5)]
        resp = _mock_resp(tokens)
        session = MagicMock()
        session.post = MagicMock(return_value=_ctx(resp))
        b._get_session = MagicMock(return_value=session)
        out = []
        async for chunk in b.generate_stream(GenerateRequest(prompt=f"prompt {i}")):
            out.append(chunk)
        return out

    async def run_all():
        return await asyncio.gather(*[one_stream(i) for i in range(100)])

    loop = asyncio.new_event_loop()
    try:
        results = loop.run_until_complete(run_all())
    finally:
        loop.close()

    assert len(results) == 100
    for i, chunks in enumerate(results):
        texts = [c.text for c in chunks if c.text]
        assert texts == [f"t{j}" for j in range(5)], f"stream {i} wrong tokens"
        assert chunks[-1].done is True

    # All inflight counters must be back to zero
    pressure = {p: v for p, v in _inflight.items() if v != 0}
    assert pressure == {}, f"inflight not zeroed: {pressure}"


def test_generate_stream_inflight_zero_after_100_sequential():
    _reset()

    async def run():
        for i in range(100):
            b = MlxBackend(port=8083, agent_id=f"seq-{i}")
            tokens = [f"tok{i}"]
            resp = _mock_resp(tokens)
            session = MagicMock()
            session.post = MagicMock(return_value=_ctx(resp))
            b._get_session = MagicMock(return_value=session)
            async for _ in b.generate_stream(GenerateRequest(prompt="x")):
                pass

    loop = asyncio.new_event_loop()
    try:
        loop.run_until_complete(run())
    finally:
        loop.close()

    assert _inflight.get(8083, 0) == 0
