"""pgvector store via asyncpg. All DB errors are logged loudly (CLAUDE.md §2)."""
from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from typing import Any, Protocol, Sequence

import asyncpg

from orchestration.telemetry.metrics import RAG_DB_ERRORS, RAG_QUERY_SECONDS

logger = logging.getLogger(__name__)

DEFAULT_DSN = os.environ.get(
    "RAG_DSN", "postgresql://matrix:matrix@127.0.0.1:5433/matrix_rag"
)


@dataclass(frozen=True)
class UpsertRow:
    source_path: str
    chunk_idx: int
    content: str
    embedding: Sequence[float]
    metadata: dict[str, Any]


@dataclass(frozen=True)
class SearchHit:
    id: int
    source_path: str
    chunk_idx: int
    content: str
    metadata: dict[str, Any]
    distance: float


class StoreProtocol(Protocol):
    async def upsert_chunks(self, rows: Sequence[UpsertRow]) -> int: ...
    async def search(self, query_vec: Sequence[float], k: int = 3) -> list[SearchHit]: ...


def _vec_literal(v: Sequence[float]) -> str:
    """Render a Python list as a pgvector literal: '[0.1,0.2,...]'."""
    return "[" + ",".join(f"{x:.6f}" for x in v) + "]"


class PgVectorStore:
    def __init__(self, dsn: str = DEFAULT_DSN) -> None:
        self.dsn = dsn
        self._pool: asyncpg.Pool | None = None

    async def _pool_or_connect(self) -> asyncpg.Pool:
        if self._pool is None:
            try:
                self._pool = await asyncpg.create_pool(self.dsn, min_size=1, max_size=4)
            except Exception as exc:
                logger.error("rag: failed to connect to %s: %s", self.dsn, exc)
                RAG_DB_ERRORS.labels(op="connect").inc()
                raise
        return self._pool

    async def close(self) -> None:
        if self._pool is not None:
            await self._pool.close()
            self._pool = None

    async def upsert_chunks(self, rows: Sequence[UpsertRow]) -> int:
        if not rows:
            return 0
        pool = await self._pool_or_connect()
        payload = [
            (r.source_path, r.chunk_idx, r.content, _vec_literal(r.embedding),
             json.dumps(r.metadata))
            for r in rows
        ]
        sql = """
            INSERT INTO chunks (source_path, chunk_idx, content, embedding, metadata)
            VALUES ($1, $2, $3, $4::vector, $5::jsonb)
            ON CONFLICT (source_path, chunk_idx) DO UPDATE SET
                content = EXCLUDED.content,
                embedding = EXCLUDED.embedding,
                metadata = EXCLUDED.metadata,
                created_at = now()
        """
        try:
            async with pool.acquire() as conn:
                await conn.executemany(sql, payload)
            return len(rows)
        except Exception as exc:
            logger.error("rag: upsert of %d rows failed: %s", len(rows), exc)
            RAG_DB_ERRORS.labels(op="upsert").inc()
            raise

    async def search(self, query_vec: Sequence[float], k: int = 3) -> list[SearchHit]:
        pool = await self._pool_or_connect()
        sql = """
            SELECT id, source_path, chunk_idx, content, metadata,
                   embedding <=> $1::vector AS distance
              FROM chunks
             ORDER BY embedding <=> $1::vector
             LIMIT $2
        """
        with RAG_QUERY_SECONDS.time():
            try:
                async with pool.acquire() as conn:
                    rows = await conn.fetch(sql, _vec_literal(query_vec), k)
            except Exception as exc:
                logger.error("rag: search failed (k=%d): %s", k, exc)
                RAG_DB_ERRORS.labels(op="search").inc()
                raise
        return [
            SearchHit(
                id=r["id"],
                source_path=r["source_path"],
                chunk_idx=r["chunk_idx"],
                content=r["content"],
                metadata=json.loads(r["metadata"]) if isinstance(r["metadata"], str)
                         else dict(r["metadata"] or {}),
                distance=float(r["distance"]),
            )
            for r in rows
        ]
