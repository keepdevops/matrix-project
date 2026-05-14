"""Embedding interface + a deterministic hash-based fallback for tests/CI.

The production embedder loads an MLX model (e.g. bge-base-en-v1.5, 768-d). The
fallback HashEmbedder produces deterministic 768-d vectors from token hashes —
useful for tests and as a placeholder when MLX/model weights aren't available.
"""
from __future__ import annotations

import hashlib
import logging
import math
import time
from abc import ABC, abstractmethod
from typing import Sequence

logger = logging.getLogger(__name__)

EMBED_DIM = 768


class Embedder(ABC):
    dim: int = EMBED_DIM

    @abstractmethod
    async def embed(self, texts: Sequence[str]) -> list[list[float]]:
        ...


class HashEmbedder(Embedder):
    """Deterministic, MLX-free embeddings for tests. Not semantically useful."""

    def __init__(self, dim: int = EMBED_DIM) -> None:
        self.dim = dim

    async def embed(self, texts: Sequence[str]) -> list[list[float]]:
        from orchestration.telemetry.metrics import RAG_EMBED_SECONDS
        start = time.perf_counter()
        try:
            return [self._vec(t) for t in texts]
        finally:
            RAG_EMBED_SECONDS.observe(time.perf_counter() - start)

    def _vec(self, text: str) -> list[float]:
        out = [0.0] * self.dim
        tokens = text.split() or [text]
        for tok in tokens:
            h = hashlib.blake2b(tok.encode("utf-8"), digest_size=16).digest()
            for i, byte in enumerate(h):
                out[(i * 7) % self.dim] += (byte - 128) / 128.0
        norm = math.sqrt(sum(x * x for x in out)) or 1.0
        return [x / norm for x in out]


class MLXEmbedder(Embedder):
    """Real embedder. Lazy-loads the MLX model on first call."""

    def __init__(self, model_id: str = "mlx-community/bge-base-en-v1.5",
                 dim: int = EMBED_DIM) -> None:
        self.model_id = model_id
        self.dim = dim
        self._model = None  # filled on first embed()

    async def embed(self, texts: Sequence[str]) -> list[list[float]]:
        # Intentionally minimal — full implementation lands when MLX embed
        # weights are pinned in the env. For now this raises so callers know
        # to use HashEmbedder until the model is wired.
        logger.error("MLXEmbedder not yet implemented (model=%s)", self.model_id)
        raise NotImplementedError(
            "MLXEmbedder requires mlx-lm model loading — wire in a follow-up."
        )
