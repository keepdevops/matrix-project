"""Tests for the POST /embed sidecar endpoint added for MLX/bge coordinator support."""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))

from aiohttp.test_utils import TestClient, TestServer  # noqa: E402
from orchestration.rag.service import make_app  # noqa: E402


async def _post(path: str, payload: dict) -> tuple[int, object]:
    app = make_app("hash")
    async with TestClient(TestServer(app)) as cli:
        resp = await cli.post(path, json=payload)
        ct = resp.headers.get("Content-Type", "")
        body = await resp.json() if "application/json" in ct else await resp.text()
        return resp.status, body


def test_embed_returns_vector_for_single_text():
    status, body = asyncio.run(_post("/embed", {"texts": ["hello world"]}))
    assert status == 200
    assert len(body["vectors"]) == 1
    assert len(body["vectors"][0]) == 768
    assert all(isinstance(v, float) for v in body["vectors"][0])


def test_embed_returns_multiple_vectors():
    status, body = asyncio.run(_post("/embed", {"texts": ["alpha", "beta", "gamma"]}))
    assert status == 200
    assert len(body["vectors"]) == 3
    assert all(len(v) == 768 for v in body["vectors"])


def test_embed_empty_list_returns_empty():
    status, body = asyncio.run(_post("/embed", {"texts": []}))
    assert status == 200
    assert body["vectors"] == []


def test_embed_missing_texts_returns_400():
    status, _ = asyncio.run(_post("/embed", {"wrong_key": ["x"]}))
    assert status == 400


def test_embed_non_string_texts_returns_400():
    status, _ = asyncio.run(_post("/embed", {"texts": [1, 2, 3]}))
    assert status == 400


def test_embed_over_512_texts_returns_400():
    status, _ = asyncio.run(_post("/embed", {"texts": ["x"] * 513}))
    assert status == 400


def test_embed_hash_vectors_are_deterministic():
    text = "kv router coordinator dispatch"

    async def run():
        app = make_app("hash")
        async with TestClient(TestServer(app)) as cli:
            r1 = await cli.post("/embed", json={"texts": [text]})
            r2 = await cli.post("/embed", json={"texts": [text]})
            b1, b2 = await r1.json(), await r2.json()
            return b1["vectors"][0], b2["vectors"][0]

    v1, v2 = asyncio.run(run())
    assert v1 == v2
