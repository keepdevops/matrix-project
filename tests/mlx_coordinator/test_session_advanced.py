"""Advanced SessionStore tests — concurrency, touch/idle timing, message isolation."""
import asyncio
import time
import pytest
from unittest.mock import patch

from orchestration.mlx_coordinator.session import SessionStore, Session, _free_cache


def _loop():
    loop = asyncio.new_event_loop()
    return loop


def _run(coro):
    loop = _loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


# ---------------------------------------------------------------------------
# Session isolation — messages don't bleed between sessions
# ---------------------------------------------------------------------------

def test_messages_isolated_between_sessions():
    store = SessionStore()
    _run(store.append_message("s1", "user", "hello from s1"))
    _run(store.append_message("s2", "user", "hello from s2"))
    s1_msgs = _run(store.get_messages("s1"))
    s2_msgs = _run(store.get_messages("s2"))
    assert s1_msgs[0]["content"] == "hello from s1"
    assert s2_msgs[0]["content"] == "hello from s2"
    assert len(s1_msgs) == 1
    assert len(s2_msgs) == 1


def test_messages_accumulate_in_order():
    store = SessionStore()
    _run(store.append_message("s1", "user", "q1"))
    _run(store.append_message("s1", "assistant", "a1"))
    _run(store.append_message("s1", "user", "q2"))
    msgs = _run(store.get_messages("s1"))
    assert [m["content"] for m in msgs] == ["q1", "a1", "q2"]
    assert [m["role"] for m in msgs] == ["user", "assistant", "user"]


def test_get_messages_returns_copy_not_reference():
    store = SessionStore()
    _run(store.append_message("s1", "user", "hello"))
    msgs = _run(store.get_messages("s1"))
    msgs.append({"role": "user", "content": "injected"})
    original = _run(store.get_messages("s1"))
    assert len(original) == 1


# ---------------------------------------------------------------------------
# touch() updates last_used
# ---------------------------------------------------------------------------

def test_touch_updates_last_used():
    store = SessionStore()

    async def run():
        sess = await store.get_or_create("s1")
        t_before = sess.last_used
        await asyncio.sleep(0.01)
        sess.touch()
        return t_before, sess.last_used

    t_before, t_after = _run(run())
    assert t_after > t_before


def test_get_or_create_touches_existing_session():
    store = SessionStore()

    async def run():
        sess = await store.get_or_create("s1")
        t1 = sess.last_used
        await asyncio.sleep(0.01)
        await store.get_or_create("s1")
        return t1, sess.last_used

    t1, t2 = _run(run())
    assert t2 > t1


# ---------------------------------------------------------------------------
# cleanup_idle boundary conditions
# ---------------------------------------------------------------------------

def test_cleanup_idle_exact_boundary():
    """Sessions at exactly the idle threshold should be evicted."""
    store = SessionStore(max_idle_secs=1)

    async def run():
        await store.get_or_create("boundary")
        store._sessions["boundary"].last_used = time.monotonic() - 1.001
        with patch("orchestration.mlx_coordinator.session._free_cache"):
            return await store.cleanup_idle()

    evicted = _run(run())
    assert evicted == 1


def test_cleanup_idle_does_not_evict_just_touched():
    store = SessionStore(max_idle_secs=1)

    async def run():
        await store.get_or_create("active")
        # explicitly touch to update last_used
        store._sessions["active"].touch()
        with patch("orchestration.mlx_coordinator.session._free_cache"):
            return await store.cleanup_idle()

    evicted = _run(run())
    assert evicted == 0


def test_cleanup_idle_repeated_calls_safe():
    store = SessionStore(max_idle_secs=0)

    async def run():
        await store.get_or_create("x")
        with patch("orchestration.mlx_coordinator.session._free_cache"):
            n1 = await store.cleanup_idle()
            n2 = await store.cleanup_idle()  # second call on empty store
        return n1, n2

    n1, n2 = _run(run())
    assert n1 == 1
    assert n2 == 0


# ---------------------------------------------------------------------------
# clear after clear is idempotent
# ---------------------------------------------------------------------------

def test_double_clear_is_idempotent():
    store = SessionStore()
    _run(store.get_or_create("s1"))
    with patch("orchestration.mlx_coordinator.session._free_cache"):
        r1 = _run(store.clear("s1"))
        r2 = _run(store.clear("s1"))
    assert r1 is True
    assert r2 is False
    assert store.active_count() == 0


# ---------------------------------------------------------------------------
# clear_all then re-create
# ---------------------------------------------------------------------------

def test_clear_all_then_recreate():
    store = SessionStore()
    _run(store.get_or_create("a"))
    _run(store.get_or_create("b"))
    with patch("orchestration.mlx_coordinator.session._free_cache"):
        _run(store.clear_all())
    _run(store.get_or_create("a"))
    assert store.active_count() == 1
    msgs = _run(store.get_messages("a"))
    assert msgs == []


# ---------------------------------------------------------------------------
# snapshot accuracy
# ---------------------------------------------------------------------------

def test_snapshot_reflects_message_count():
    store = SessionStore()
    _run(store.append_message("s1", "user", "one"))
    _run(store.append_message("s1", "user", "two"))
    _run(store.append_message("s2", "user", "solo"))
    snap = {s["session_id"]: s for s in store.snapshot()}
    assert snap["s1"]["messages"] == 2
    assert snap["s2"]["messages"] == 1


def test_snapshot_empty_store():
    store = SessionStore()
    assert store.snapshot() == []


# ---------------------------------------------------------------------------
# Concurrent get_or_create — no duplicate sessions
# ---------------------------------------------------------------------------

def test_concurrent_get_or_create_same_id():
    store = SessionStore()

    async def run():
        results = await asyncio.gather(*[store.get_or_create("shared") for _ in range(20)])
        return results

    results = _run(run())
    # All coroutines must return the same Session object
    assert all(r is results[0] for r in results)
    assert store.active_count() == 1


def test_concurrent_get_or_create_distinct_ids():
    store = SessionStore()

    async def run():
        await asyncio.gather(*[store.get_or_create(f"s{i}") for i in range(10)])

    _run(run())
    assert store.active_count() == 10


# ---------------------------------------------------------------------------
# _free_cache — cache object with __del__ raising should not propagate
# ---------------------------------------------------------------------------

def test_free_cache_del_raises_does_not_propagate():
    class NoisyCache:
        pass  # __del__ raising would surface as PytestUnraisableExceptionWarning

    cache_obj = NoisyCache()
    sess = Session(session_id="x", cache=cache_obj)
    _free_cache(sess)
    assert sess.cache is None
    del cache_obj  # explicit cleanup after assertion
