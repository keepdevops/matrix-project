"""End-to-end test: POST /api/architect {use_rag: true} against the C++
coordinator with a seeded pgvector. Verifies the dispatch path prepends a
<context source="rag"> block and surfaces meta.rag.

Skips automatically if pgvector is not reachable at RAG_DSN (or the default
postgresql://matrix:matrix@127.0.0.1:5433/matrix_rag)."""
from __future__ import annotations

import asyncio
import json
import os
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path

import pytest
import urllib.request

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / "tests"))

from mock_agent import MockAgent  # noqa: E402
from orchestration.rag.embed import HashEmbedder  # noqa: E402
from orchestration.rag.store import PgVectorStore, UpsertRow  # noqa: E402

COORD_BIN = REPO / "coordinator"
COORD_PORT = 18000
DSN = os.environ.get(
    "RAG_DSN", "postgresql://matrix:matrix@127.0.0.1:5433/matrix_rag")
TEST_SOURCE = "test/rag-coord-dispatch.md"
TEST_CONTENT = "the answer to the integration question is forty-two"
AGENTS = [
    {"name": "architect", "port": 18080},
    {"name": "programmer", "port": 18081},
]


def _pg_reachable() -> bool:
    try:
        import asyncpg
        async def _go():
            c = await asyncpg.connect(DSN, timeout=2)
            await c.fetchval("SELECT 1")
            await c.close()
        asyncio.run(_go())
        return True
    except Exception:
        return False


pytestmark = pytest.mark.skipif(
    not COORD_BIN.exists(), reason=f"coordinator binary missing at {COORD_BIN}",
)


def _wait_port(port: int, timeout: float = 8.0) -> bool:
    end = time.time() + timeout
    while time.time() < end:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(0.2)
            try:
                s.connect(("127.0.0.1", port))
                return True
            except OSError:
                time.sleep(0.05)
    return False


def _agent_entry(a: dict) -> dict:
    return {
        "name": a["name"], "port": a["port"], "read_timeout_secs": 5,
        "max_tokens": 256, "system_prompt": f"You are {a['name']}.",
        "engine": "llama", "backend": "llama",
        "model": "", "draft_model": "", "draft_max": 0,
    }


def _swarm_config_with_rag() -> dict:
    return {
        "agents": [_agent_entry(a) for a in AGENTS],
        "coordinator": {"default_mode": "flat", "modes": {}, "port": COORD_PORT},
        "rag": {"enabled": True, "top_k": 3, "min_score": 1.0,
                "embedder": "hash", "dsn": DSN},
    }


def _http(method: str, path: str, body=None):
    url = f"http://127.0.0.1:{COORD_PORT}{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        url, data=data, method=method,
        headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.status, json.loads(resp.read() or b"{}")


async def _purge_pgvector() -> None:
    import asyncpg
    conn = await asyncpg.connect(DSN)
    try:
        await conn.execute("DELETE FROM chunks WHERE source_path = $1", TEST_SOURCE)
    finally:
        await conn.close()


async def _seed_pgvector() -> None:
    await _purge_pgvector()
    store = PgVectorStore(DSN)
    emb = HashEmbedder()
    try:
        vecs = await emb.embed([TEST_CONTENT])
        await store.upsert_chunks([UpsertRow(
            source_path=TEST_SOURCE, chunk_idx=0,
            content=TEST_CONTENT, embedding=vecs[0], metadata={})])
    finally:
        await store.close()


@pytest.fixture
def matrix_rag(tmp_path):
    if not _pg_reachable():
        pytest.skip(f"pgvector not reachable at {DSN}")

    asyncio.run(_seed_pgvector())

    mocks = {a["name"]: MockAgent(a["name"], a["port"]) for a in AGENTS}
    for m in mocks.values():
        m.start()

    cfg_path = tmp_path / "rag-test-config.json"
    cfg_path.write_text(json.dumps(_swarm_config_with_rag(), indent=2))

    env = os.environ.copy()
    env["MATRIX_COORDINATOR_PORT"] = str(COORD_PORT)
    env["RAG_DSN"] = DSN
    env.pop("MATRIX_SOURCE_CONFIG", None)
    log_path = tmp_path / "coordinator.log"
    log_fp = open(log_path, "wb")
    proc = subprocess.Popen(
        [str(COORD_BIN), "--config", str(cfg_path)],
        env=env, stdout=log_fp, stderr=subprocess.STDOUT,
        preexec_fn=os.setsid,
    )
    if not _wait_port(COORD_PORT):
        log_fp.close()
        proc.kill()
        for m in mocks.values(): m.stop()
        asyncio.run(_purge_pgvector())
        pytest.fail(f"coordinator didn't bind {COORD_PORT}\n{log_path.read_text(errors='replace')}")

    try:
        yield mocks
    finally:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
            proc.wait(timeout=3)
        except Exception:
            try: proc.kill()
            except Exception: pass
        log_fp.close()
        for m in mocks.values(): m.stop()
        asyncio.run(_purge_pgvector())


def test_use_rag_true_injects_context_and_surfaces_meta(matrix_rag):
    status, env = _http("POST", "/api/architect",
                        {"prompt": TEST_CONTENT, "use_rag": True})
    assert status == 200, env

    meta_rag = env.get("meta", {}).get("rag", {})
    assert meta_rag.get("requested") is True
    assert meta_rag.get("used") is True, f"expected hits, got meta.rag={meta_rag}"
    hits = meta_rag.get("hits") or []
    assert any(h["source_path"] == TEST_SOURCE for h in hits), hits

    # Mock should have seen the context block prepended to its prompt.
    seen = matrix_rag["architect"].prompts_received
    assert seen, "architect received no prompt"
    assert '<context source="rag">' in seen[-1]
    assert TEST_CONTENT in seen[-1]


def test_use_rag_false_skips_injection(matrix_rag):
    status, env = _http("POST", "/api/architect",
                        {"prompt": TEST_CONTENT, "use_rag": False})
    assert status == 200, env

    assert "rag" not in env.get("meta", {})
    seen = matrix_rag["architect"].prompts_received
    assert seen
    assert '<context source="rag">' not in seen[-1]
