"""High-level RAG retrieval API — used by orchestration modes."""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Protocol, Sequence

from orchestration.telemetry.metrics import RAG_CHUNKS_RETURNED

from .embed import Embedder
from .store import SearchHit

logger = logging.getLogger(__name__)


class _Searchable(Protocol):
    async def search(self, query_vec: Sequence[float], k: int = 3) -> list[SearchHit]: ...


@dataclass(frozen=True)
class RetrievedChunk:
    content: str
    source_path: str
    metadata: dict
    distance: float


async def retrieve(
    query: str,
    *,
    embedder: Embedder,
    store: _Searchable,
    k: int = 3,
) -> list[RetrievedChunk]:
    if not query.strip():
        logger.error("rag: retrieve called with empty query")
        raise ValueError("retrieve: query must be non-empty")
    try:
        [vec] = await embedder.embed([query])
    except Exception as exc:
        logger.error("rag: embed for query failed: %s", exc)
        raise

    hits = await store.search(vec, k=k)
    RAG_CHUNKS_RETURNED.observe(len(hits))
    return [
        RetrievedChunk(
            content=h.content,
            source_path=h.source_path,
            metadata=h.metadata,
            distance=h.distance,
        )
        for h in hits
    ]
