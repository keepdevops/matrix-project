"""Embedding interface + a deterministic hash-based fallback for tests/CI.

The production embedder loads an MLX model (e.g. bge-base-en-v1.5, 768-d). The
fallback HashEmbedder produces deterministic 768-d vectors from token hashes —
useful for tests and as a placeholder when MLX/model weights aren't available.
"""
from __future__ import annotations

import hashlib
import logging
import math
import os
import time
from abc import ABC, abstractmethod
from typing import Sequence

logger = logging.getLogger(__name__)

EMBED_DIM = 768


def _force_offline_hf() -> None:
    """Pin HuggingFace/transformers to offline mode so the MLX embedder loads
    only from the local cache and never reaches the network — required for
    air-gapped deployments. Must run before huggingface_hub/transformers are
    imported (they read these env vars at import time); the model import is lazy
    in MLXEmbedder._ensure_loaded, so setting them here at module import is early
    enough.

    Escape hatch: set MATRIX_RAG_EMBED_ALLOW_DOWNLOAD=1 to permit a one-time
    online download that seeds the cache on a connected host.
    """
    if os.environ.get("MATRIX_RAG_EMBED_ALLOW_DOWNLOAD", "").lower() in ("1", "true", "yes"):
        logger.warning("MLXEmbedder: MATRIX_RAG_EMBED_ALLOW_DOWNLOAD set — "
                       "allowing online HuggingFace downloads to seed the cache")
        return
    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")


_force_offline_hf()


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
    """MLX-backed embedder via mlx-embedding-models. Lazy-loads on first call.

    Default model is bge-small-en-v1.5 (384-d) — fast on Apple Silicon and
    available in mlx-embedding-models' built-in registry. Pass a registry
    key or HuggingFace repo id to use a different model.
    """

    # bge-base = 768-d. Matches the chunks.embedding vector(768) column.
    DEFAULT_MODEL = "bge-base"
    DEFAULT_DIM = 768

    def __init__(self, model_id: str = DEFAULT_MODEL, dim: int | None = None,
                 batch_size: int = 32, max_length: int = 512) -> None:
        self.model_id = model_id
        self.dim = dim or self.DEFAULT_DIM
        self.batch_size = batch_size
        self.max_length = max_length
        self._model = None  # filled on first embed()

    def _ensure_loaded(self) -> None:
        if self._model is not None:
            return
        try:
            from mlx_embedding_models.embedding import EmbeddingModel
        except ImportError as exc:
            logger.error("mlx-embedding-models not installed: %s", exc)
            raise
        offline = os.environ.get("HF_HUB_OFFLINE") == "1"
        try:
            self._model = EmbeddingModel.from_registry(self.model_id)
        except Exception as exc:
            logger.info("MLXEmbedder: registry miss for %s (%s), trying HF repo id",
                        self.model_id, exc)
            try:
                self._model = EmbeddingModel.from_pretrained(self.model_id)
            except Exception as exc2:
                if offline:
                    logger.error(
                        "MLXEmbedder: could not load %s from the local cache in "
                        "offline mode (HF_HUB_OFFLINE=1). Pre-seed the HuggingFace "
                        "cache (~/.cache/huggingface or $HF_HOME) on this host, or "
                        "run once with MATRIX_RAG_EMBED_ALLOW_DOWNLOAD=1 to download "
                        "it: %s", self.model_id, exc2)
                raise
        emitted = getattr(self._model, "dim", None) or getattr(
            self._model, "embedding_dim", None)
        if isinstance(emitted, int) and emitted > 0:
            self.dim = emitted
        # transformers >= 4.44 removed batch_encode_plus; patch it back as an
        # alias for __call__ so mlx-embedding-models 0.0.x continues to work.
        tok = getattr(self._model, "tokenizer", None)
        if tok is not None and not callable(getattr(tok, "batch_encode_plus", None)):
            tok.batch_encode_plus = tok.__call__

    async def embed(self, texts: Sequence[str]) -> list[list[float]]:
        from orchestration.telemetry.metrics import RAG_EMBED_SECONDS

        if not texts:
            return []
        start = time.perf_counter()
        try:
            self._ensure_loaded()
            arr = self._model.encode(
                list(texts),
                batch_size=self.batch_size,
            )
            return [list(map(float, row)) for row in arr]
        except Exception as exc:
            logger.error("MLXEmbedder.embed failed for %d texts: %s",
                         len(texts), exc)
            raise
        finally:
            RAG_EMBED_SECONDS.observe(time.perf_counter() - start)
