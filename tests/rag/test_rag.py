"""RAG unit tests using HashEmbedder + an in-memory store (no Postgres needed)."""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from typing import Sequence

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))

from orchestration.rag import chunk_text, retrieve  # noqa: E402
from orchestration.rag.embed import HashEmbedder  # noqa: E402
from orchestration.rag.store import SearchHit, UpsertRow  # noqa: E402


class InMemoryStore:
    """Cosine-distance ranking over a dict — mirrors PgVectorStore API."""

    def __init__(self) -> None:
        self.rows: list[UpsertRow] = []

    async def upsert_chunks(self, rows: Sequence[UpsertRow]) -> int:
        keys = {(r.source_path, r.chunk_idx) for r in rows}
        self.rows = [r for r in self.rows if (r.source_path, r.chunk_idx) not in keys]
        self.rows.extend(rows)
        return len(rows)

    async def search(self, query_vec: Sequence[float], k: int = 3) -> list[SearchHit]:
        def cos(a: Sequence[float], b: Sequence[float]) -> float:
            return 1.0 - sum(x * y for x, y in zip(a, b))
        ranked = sorted(
            ((cos(query_vec, r.embedding), r) for r in self.rows),
            key=lambda p: p[0],
        )[:k]
        return [
            SearchHit(
                id=i,
                source_path=r.source_path,
                chunk_idx=r.chunk_idx,
                content=r.content,
                metadata=r.metadata,
                distance=d,
            )
            for i, (d, r) in enumerate(ranked)
        ]


def test_chunker_python_splits_functions():
    src = """
def alpha():
    return 1

def beta(x):
    return x + 1

class Gamma:
    def m(self): pass
"""
    chunks = chunk_text("x.py", src)
    names = sorted(c.metadata["name"] for c in chunks)
    assert names == ["Gamma", "alpha", "beta"]


def test_chunker_cpp_finds_functions():
    src = """
int add(int a, int b) {
    return a + b;
}

void greet(const std::string& name) {
    std::cout << name;
}
"""
    chunks = chunk_text("x.cpp", src)
    names = {c.metadata["name"] for c in chunks}
    assert {"add", "greet"} <= names


def test_chunker_fallback_window_for_unknown():
    text = "\n".join(f"line {i}" for i in range(200))
    chunks = chunk_text("x.notes", text)
    assert len(chunks) > 1
    assert all(c.metadata["lang"] == "text" for c in chunks)


def test_retrieve_round_trip():
    async def run():
        store = InMemoryStore()
        emb = HashEmbedder()
        docs = [
            ("a.py", 0, "parse url string into components"),
            ("b.py", 0, "compute sha256 hash of binary data"),
            ("c.py", 0, "render react component tree"),
        ]
        vecs = await emb.embed([d[2] for d in docs])
        rows = [UpsertRow(d[0], d[1], d[2], v, {}) for d, v in zip(docs, vecs)]
        await store.upsert_chunks(rows)

        hits = await retrieve("parse url string", embedder=emb, store=store, k=1)
        assert len(hits) == 1
        # HashEmbedder is token-based; exact-token-overlap doc should win.
        assert hits[0].source_path == "a.py"

    asyncio.run(run())
