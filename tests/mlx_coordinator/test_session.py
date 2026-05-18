"""Tests for SessionStore — cache lifecycle, cleanup, idle eviction."""
import asyncio
import time
import pytest
from unittest.mock import patch, MagicMock

from orchestration.mlx_coordinator.session import SessionStore, _free_cache, Session


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


# ---------------------------------------------------------------------------
# get_or_create
# ---------------------------------------------------------------------------

def test_get_or_create_new_session():
    store = SessionStore()
    sess = _run(store.get_or_create("s1"))
    assert sess.session_id == "s1"
    assert sess.messages == []
    assert store.active_count() == 1


def test_get_or_create_returns_same_session():
    store = SessionStore()
    s1 = _run(store.get_or_create("s1"))
    s2 = _run(store.get_or_create("s1"))
    assert s1 is s2
    assert store.active_count() == 1


def test_get_or_create_multiple_sessions():
    store = SessionStore()
    _run(store.get_or_create("a"))
    _run(store.get_or_create("b"))
    _run(store.get_or_create("c"))
    assert store.active_count() == 3


# ---------------------------------------------------------------------------
# append_message / get_messages
# ---------------------------------------------------------------------------

def test_append_and_get_messages():
    store = SessionStore()
    _run(store.append_message("s1", "user", "hello"))
    _run(store.append_message("s1", "assistant", "hi"))
    msgs = _run(store.get_messages("s1"))
    assert msgs == [
        {"role": "user", "content": "hello"},
        {"role": "assistant", "content": "hi"},
    ]


def test_get_messages_unknown_session_returns_empty():
    store = SessionStore()
    msgs = _run(store.get_messages("nonexistent"))
    assert msgs == []


# ---------------------------------------------------------------------------
# clear
# ---------------------------------------------------------------------------

def test_clear_existing_session():
    store = SessionStore()
    _run(store.get_or_create("s1"))
    with patch("orchestration.mlx_coordinator.session._free_cache") as mock_free:
        cleared = _run(store.clear("s1"))
    assert cleared is True
    assert store.active_count() == 0
    mock_free.assert_called_once()


def test_clear_nonexistent_session_returns_false():
    store = SessionStore()
    with patch("orchestration.mlx_coordinator.session._free_cache") as mock_free:
        cleared = _run(store.clear("ghost"))
    assert cleared is False
    mock_free.assert_not_called()


def test_clear_all():
    store = SessionStore()
    _run(store.get_or_create("a"))
    _run(store.get_or_create("b"))
    with patch("orchestration.mlx_coordinator.session._free_cache"):
        count = _run(store.clear_all())
    assert count == 2
    assert store.active_count() == 0


def test_clear_all_empty_store():
    store = SessionStore()
    with patch("orchestration.mlx_coordinator.session._free_cache"):
        count = _run(store.clear_all())
    assert count == 0


# ---------------------------------------------------------------------------
# cleanup_idle
# ---------------------------------------------------------------------------

def test_cleanup_idle_evicts_stale_sessions():
    store = SessionStore(max_idle_secs=0)
    _run(store.get_or_create("old"))
    with patch("orchestration.mlx_coordinator.session._free_cache"):
        evicted = _run(store.cleanup_idle())
    assert evicted == 1
    assert store.active_count() == 0


def test_cleanup_idle_keeps_fresh_sessions():
    store = SessionStore(max_idle_secs=9999)
    _run(store.get_or_create("fresh"))
    with patch("orchestration.mlx_coordinator.session._free_cache"):
        evicted = _run(store.cleanup_idle())
    assert evicted == 0
    assert store.active_count() == 1


def test_cleanup_idle_mixed():
    store = SessionStore(max_idle_secs=1)
    _run(store.get_or_create("old"))
    store._sessions["old"].last_used = time.monotonic() - 10
    _run(store.get_or_create("fresh"))
    with patch("orchestration.mlx_coordinator.session._free_cache"):
        evicted = _run(store.cleanup_idle())
    assert evicted == 1
    assert store.active_count() == 1
    assert "fresh" in store._sessions


# ---------------------------------------------------------------------------
# snapshot
# ---------------------------------------------------------------------------

def test_snapshot_contents():
    store = SessionStore()
    _run(store.append_message("s1", "user", "hello"))
    snap = store.snapshot()
    assert len(snap) == 1
    assert snap[0]["session_id"] == "s1"
    assert snap[0]["messages"] == 1
    assert "idle_secs" in snap[0]


# ---------------------------------------------------------------------------
# _free_cache
# ---------------------------------------------------------------------------

def test_free_cache_deletes_cache_object():
    mock_cache = MagicMock()
    sess = Session(session_id="x", cache=mock_cache)
    _free_cache(sess)
    assert sess.cache is None


def test_free_cache_no_cache_does_not_raise():
    sess = Session(session_id="x", cache=None)
    _free_cache(sess)  # must not raise


def test_free_cache_calls_metal_clear_when_mx_available():
    import orchestration.mlx_coordinator.session as sess_mod
    mock_mx = MagicMock()
    original = sess_mod.mx
    sess_mod.mx = mock_mx
    try:
        _free_cache(Session(session_id="x", cache=None))
        mock_mx.metal.clear_cache.assert_called_once()
    finally:
        sess_mod.mx = original
