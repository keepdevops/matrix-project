"""MLX session lifecycle — per-session KV cache objects with explicit cleanup.

Each chat session gets its own cache entry. Cleanup calls mx.metal.clear_cache()
to release Metal allocator buffers that Python GC does not guarantee to flush.
Idle sessions are evicted after max_idle_secs (default 300s).
"""
from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Any

try:
    import mlx.core as mx  # type: ignore
except ImportError:
    mx = None  # type: ignore  # MLX not installed (e.g. test environment)

logger = logging.getLogger(__name__)


@dataclass
class Session:
    session_id: str
    messages: list[dict[str, str]] = field(default_factory=list)
    cache: Any = None          # mlx_lm make_prompt_cache object or None
    last_used: float = field(default_factory=time.monotonic)

    def touch(self) -> None:
        self.last_used = time.monotonic()


class SessionStore:
    """Thread-safe (asyncio) store for MLX chat sessions."""

    def __init__(self, max_idle_secs: int = 300, max_sessions: int = 50,
                 max_messages: int = 100) -> None:
        self._sessions: dict[str, Session] = {}
        self._lock: asyncio.Lock | None = None  # created lazily inside the event loop
        self.max_idle_secs = max_idle_secs
        self.max_sessions = max_sessions
        self.max_messages = max_messages

    def _get_lock(self) -> asyncio.Lock:
        if self._lock is None:
            self._lock = asyncio.Lock()
        return self._lock

    async def get_or_create(self, session_id: str) -> Session:
        async with self._get_lock():
            if session_id not in self._sessions:
                if len(self._sessions) >= self.max_sessions:
                    lru = min(self._sessions.values(), key=lambda s: s.last_used)
                    evicted = self._sessions.pop(lru.session_id)
                    logger.info("mlx-session: LRU evict %s (cap=%d)", lru.session_id, self.max_sessions)
                    _free_cache(evicted)
                self._sessions[session_id] = Session(session_id=session_id)
                logger.info("mlx-session: created %s", session_id)
            sess = self._sessions[session_id]
            sess.touch()
            return sess

    async def append_message(self, session_id: str, role: str, content: str) -> None:
        sess = await self.get_or_create(session_id)
        sess.messages.append({"role": role, "content": content})
        if len(sess.messages) > self.max_messages:
            sess.messages = sess.messages[-self.max_messages:]

    async def get_messages(self, session_id: str) -> list[dict[str, str]]:
        async with self._get_lock():
            sess = self._sessions.get(session_id)
            if sess is None:
                return []
            sess.touch()
            return list(sess.messages)

    async def clear(self, session_id: str) -> bool:
        """Delete one session and flush Metal cache. Returns True if session existed."""
        async with self._get_lock():
            sess = self._sessions.pop(session_id, None)
        if sess is None:
            return False
        _free_cache(sess)
        logger.info("mlx-session: cleared %s", session_id)
        return True

    async def clear_all(self) -> int:
        async with self._get_lock():
            sessions = list(self._sessions.values())
            self._sessions.clear()
        for sess in sessions:
            _free_cache(sess)
        if sessions:
            logger.info("mlx-session: cleared all (%d sessions)", len(sessions))
        return len(sessions)

    async def cleanup_idle(self) -> int:
        """Evict sessions idle longer than max_idle_secs. Returns eviction count."""
        cutoff = time.monotonic() - self.max_idle_secs
        async with self._get_lock():
            stale = [s for s in self._sessions.values() if s.last_used < cutoff]
            for sess in stale:
                del self._sessions[sess.session_id]
        for sess in stale:
            _free_cache(sess)
            logger.info("mlx-session: evicted idle %s", sess.session_id)
        return len(stale)

    def active_count(self) -> int:
        return len(self._sessions)

    def snapshot(self) -> list[dict]:
        return [
            {"session_id": s.session_id,
             "messages": len(s.messages),
             "idle_secs": round(time.monotonic() - s.last_used, 1)}
            for s in self._sessions.values()
        ]


def _free_cache(sess: Session) -> None:
    """Delete KV cache object then flush Metal allocator."""
    if sess.cache is not None:
        try:
            del sess.cache
            sess.cache = None
        except Exception as exc:
            logger.error("mlx-session: cache delete failed for %s: %s", sess.session_id, exc)
    if mx is not None:
        try:
            mx.metal.clear_cache()
        except Exception as exc:
            logger.error("mlx-session: mx.metal.clear_cache failed: %s", exc)
