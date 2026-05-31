"""Shared fake inference backends for mode unit tests."""
from __future__ import annotations

from typing import AsyncIterator, Sequence

from backends.base import GenerateRequest, HealthStatus, InferenceBackend, TokenChunk


class FakeBackend(InferenceBackend):
    backend_id = "fake"

    def __init__(self, reply: str = "ok") -> None:
        self.reply = reply

    async def generate_stream(self, req: GenerateRequest) -> AsyncIterator[TokenChunk]:
        for ch in self.reply:
            yield TokenChunk(text=ch)
        yield TokenChunk(text="", done=True)

    async def embed(self, texts: Sequence[str]) -> list[list[float]]:
        return [[0.0] * 4 for _ in texts]

    async def health(self) -> HealthStatus:
        return HealthStatus(ok=True)


class ScriptedBackend(InferenceBackend):
    """Returns scripted replies in call order (one reply per generate_stream)."""

    backend_id = "scripted"

    def __init__(self, *replies: str) -> None:
        self.replies = list(replies) if replies else ["ok"]
        self._idx = 0

    async def generate_stream(self, req: GenerateRequest) -> AsyncIterator[TokenChunk]:
        reply = self.replies[min(self._idx, len(self.replies) - 1)]
        self._idx += 1
        for ch in reply:
            yield TokenChunk(text=ch)
        yield TokenChunk(text="", done=True)

    async def embed(self, texts: Sequence[str]) -> list[list[float]]:
        return [[0.0] for _ in texts]

    async def health(self) -> HealthStatus:
        return HealthStatus(ok=True)


class FailingBackend(InferenceBackend):
    backend_id = "fail"

    def __init__(self, message: str = "boom") -> None:
        self.message = message

    async def generate_stream(self, req: GenerateRequest) -> AsyncIterator[TokenChunk]:
        raise RuntimeError(self.message)
        yield  # pragma: no cover

    async def embed(self, texts: Sequence[str]) -> list[list[float]]:
        return []

    async def health(self) -> HealthStatus:
        return HealthStatus(ok=False, detail=self.message)
