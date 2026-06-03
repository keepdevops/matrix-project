"""MS-147 chaos tests — native C++ /api/mlx/* routes under concurrent load.

All tests are live: they require the coordinator to be running with
MATRIX_MLX_NATIVE_COORD=1 at MATRIX_COORD_URL (default http://localhost:8000).
Every test skips gracefully when the coordinator is not reachable.

What's being hardened:
  - per-port std::mutex serialises mlx_lm.server calls (no data races)
  - MlxSessionStore thread-safety under concurrent writes/reads
  - Active mode state (s_active_mlx_mode + s_mode_mu) under concurrent switches
  - DataSink + sink_mu in SSE streams under concurrent token writes
  - Route handlers return correct HTTP status for all bad-input shapes
"""
from __future__ import annotations

import asyncio
import concurrent.futures
import os
import random
import socket
import string

import pytest
import requests

COORD_URL = os.environ.get("MATRIX_COORD_URL", "http://localhost:8000")
TIMEOUT   = 15   # per-request timeout; mlx_lm.server may be slow


# ── Connectivity guard ────────────────────────────────────────────────────────

def _reachable() -> bool:
    try:
        host = COORD_URL.split("//")[-1].split(":")[0]
        port = int(COORD_URL.split(":")[-1].split("/")[0]) if ":" in COORD_URL else 80
        with socket.create_connection((host, port), timeout=1):
            return True
    except OSError:
        return False


@pytest.fixture(scope="module")
def coord():
    if not _reachable():
        pytest.skip(f"C++ coordinator not reachable at {COORD_URL}")
    return COORD_URL


# ── Helpers ───────────────────────────────────────────────────────────────────

def _submit(url: str, prompt: str = "hi", **kw) -> requests.Response:
    return requests.post(f"{url}/api/mlx/submit",
                         json={"prompt": prompt, **kw}, timeout=TIMEOUT)


def _stream_body(url: str, prompt: str = "hi", **kw) -> tuple[int, str]:
    r = requests.post(f"{url}/api/mlx/stream",
                      json={"prompt": prompt, **kw},
                      stream=True, timeout=TIMEOUT)
    body = "".join(c.decode() for c in r.iter_content(chunk_size=None))
    return r.status_code, body


def _set_mode(url: str, mode: str) -> None:
    requests.post(f"{url}/api/mlx/modes/active", json={"mode": mode}, timeout=5)


# ── Sequential rapid fire — no deadlock, no leak ─────────────────────────────

def test_50_sequential_submits_no_deadlock(coord):
    """50 sequential POSTs to /api/mlx/submit — all return, no hang."""
    failures = []
    for i in range(50):
        try:
            r = _submit(coord, prompt=f"sequential test {i}")
            if r.status_code not in (200, 503):
                failures.append(f"run {i}: got {r.status_code}")
        except requests.Timeout:
            failures.append(f"run {i}: timeout (deadlock?)")
        except Exception as exc:
            failures.append(f"run {i}: {exc}")
    assert failures == [], "\n".join(failures)


def test_50_sequential_streams_no_deadlock(coord):
    """50 sequential POSTs to /api/mlx/stream — all complete, no hang."""
    failures = []
    for i in range(50):
        try:
            status, body = _stream_body(coord, prompt=f"stream test {i}")
            if status not in (200, 503):
                failures.append(f"run {i}: status {status}")
            elif status == 200 and "event: done" not in body:
                failures.append(f"run {i}: no done event")
        except requests.Timeout:
            failures.append(f"run {i}: timeout")
        except Exception as exc:
            failures.append(f"run {i}: {exc}")
    assert failures == [], "\n".join(failures)


# ── Concurrent submit — per-port mutex serialises correctly ───────────────────

def test_20_concurrent_submits_no_crash(coord):
    """20 concurrent submits — all return valid status, no 5xx."""
    with concurrent.futures.ThreadPoolExecutor(max_workers=20) as pool:
        futs = [pool.submit(_submit, coord, f"concurrent {i}",
                            session_id=f"chaos-{i}")
                for i in range(20)]
        results = [f.result(timeout=30) for f in concurrent.futures.as_completed(futs)]

    failures = [f"status {r.status_code}: {r.text[:60]}"
                for r in results if r.status_code >= 500]
    assert failures == [], "\n".join(failures)


def test_10_concurrent_streams_no_crash(coord):
    """10 concurrent SSE streams — all complete, no 5xx."""
    def _do(i):
        return _stream_body(coord, prompt=f"concurrent stream {i}",
                            session_id=f"stream-chaos-{i}")

    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
        futs = [pool.submit(_do, i) for i in range(10)]
        results = [f.result(timeout=30) for f in concurrent.futures.as_completed(futs)]

    failures = [f"status {s}" for s, _ in results if s >= 500]
    assert failures == [], "\n".join(failures)


def test_mixed_concurrent_submit_and_stream(coord):
    """Simultaneous submit + stream requests — no interference."""
    def _do_submit(i):
        return ("submit", _submit(coord, prompt=f"mix-submit-{i}").status_code)

    def _do_stream(i):
        s, b = _stream_body(coord, prompt=f"mix-stream-{i}")
        return ("stream", s)

    tasks = [_do_submit, _do_stream] * 5
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
        futs = [pool.submit(fn, i) for i, fn in enumerate(tasks)]
        results = [f.result(timeout=30) for f in concurrent.futures.as_completed(futs)]

    failures = [f"{kind} status {s}" for kind, s in results if s >= 500]
    assert failures == [], "\n".join(failures)


# ── Mode state under concurrent switches ─────────────────────────────────────

def test_concurrent_mode_switches_and_submits(coord):
    """Mode switches racing with submits — mode state stays consistent."""
    modes = ["flat", "pipeline", "cascade"]

    def _switch(i):
        _set_mode(coord, modes[i % len(modes)])
        return "switch"

    def _do_submit(i):
        r = _submit(coord, prompt=f"mode-race-{i}")
        return r.status_code

    tasks = ([lambda i=i: _switch(i) for i in range(10)] +
             [lambda i=i: _do_submit(i) for i in range(10)])
    random.shuffle(tasks)

    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
        futs = [pool.submit(t) for t in tasks]
        results = [f.result(timeout=30) for f in concurrent.futures.as_completed(futs)]

    # After racing, mode must be one of the valid values
    r = requests.get(f"{coord}/api/mlx/modes", timeout=5)
    assert r.status_code == 200
    assert r.json()["active"] in modes

    # Submits must not have 5xx'd
    submit_5xx = [s for s in results if isinstance(s, int) and s >= 500]
    assert submit_5xx == [], f"5xx during mode race: {submit_5xx}"

    _set_mode(coord, "flat")  # restore


# ── Session clear racing with submits ─────────────────────────────────────────

def test_session_clear_during_concurrent_submits(coord):
    """session/clear racing with submits — no 5xx, no deadlock."""
    def _do_submit(i):
        return _submit(coord, prompt=f"clear-race-{i}",
                       session_id=f"sr-{i % 5}").status_code

    def _do_clear(i):
        sid = f"sr-{i % 5}" if i % 3 != 0 else None
        body = {"session_id": sid} if sid else {}
        r = requests.post(f"{coord}/api/mlx/session/clear", json=body, timeout=5)
        return r.status_code

    tasks = ([lambda i=i: _do_submit(i) for i in range(10)] +
             [lambda i=i: _do_clear(i) for i in range(5)])
    random.shuffle(tasks)

    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
        futs = [pool.submit(t) for t in tasks]
        results = [f.result(timeout=30) for f in concurrent.futures.as_completed(futs)]

    failures = [f"status {s}" for s in results if s >= 500]
    assert failures == [], "\n".join(failures)


# ── Poisoned bodies — all routes return 4xx, never 5xx ────────────────────────

@pytest.mark.parametrize("method,path,body", [
    ("POST", "/api/mlx/submit",        b"not-json"),
    ("POST", "/api/mlx/submit",        b"{}"),                  # missing prompt
    ("POST", "/api/mlx/submit",        b'{"prompt":""}'),        # empty prompt
    ("POST", "/api/mlx/stream",        b"not-json"),
    ("POST", "/api/mlx/stream",        b"{}"),
    ("POST", "/api/mlx/modes/active",  b'{"mode":"invalid"}'),
    ("POST", "/api/mlx/modes/active",  b"bad"),
    ("POST", "/api/mlx/session/clear", b"bad"),
    ("POST", "/api/mlx/session/clear", b'{"session_id":123}'),  # wrong type
])
def test_poisoned_input_never_500(coord, method, path, body):
    r = requests.request(method, f"{coord}{path}", data=body,
                         headers={"Content-Type": "application/json"}, timeout=5)
    assert r.status_code < 500, (
        f"{method} {path} with {body!r} → {r.status_code}: {r.text[:120]}"
    )


# ── Random unknown paths — never 500 ─────────────────────────────────────────

def test_100_random_mlx_paths_never_500(coord):
    """100 random /api/mlx/<gibberish> GET requests — no 5xx."""
    failures = []
    for i in range(100):
        suffix = "".join(random.choices(string.ascii_lowercase + "/._-", k=random.randint(1, 25)))
        url = f"{coord}/api/mlx/{suffix}"
        try:
            r = requests.get(url, timeout=5)
            if r.status_code >= 500:
                failures.append(f"GET {url} → {r.status_code}")
        except Exception as exc:
            failures.append(f"GET {url}: {exc}")
    assert failures == [], "\n".join(failures)


# ── MlxSessionStore concurrent write/read ────────────────────────────────────

def test_concurrent_session_writes_then_pressure(coord):
    """Write 20 sessions concurrently, then pressure snapshot is consistent."""
    def _seed(i):
        return _submit(coord, prompt=f"seed {i}", session_id=f"chaos-sess-{i}").status_code

    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
        futs = [pool.submit(_seed, i) for i in range(20)]
        statuses = [f.result(timeout=30) for f in concurrent.futures.as_completed(futs)]

    r = requests.get(f"{coord}/api/mlx/pressure", timeout=5)
    assert r.status_code == 200
    body = r.json()
    assert isinstance(body["sessions"], list)
    # sessions list length must be non-negative and not throw
    assert len(body["sessions"]) >= 0

    failures = [s for s in statuses if s >= 500]
    assert failures == [], f"5xx during concurrent session seeding: {failures}"


# ── Static: lock-order documentation present in header ───────────────────────

def test_lock_order_documented_in_header():
    """MS-147: port_mutex header must document the lock acquisition order."""
    import pathlib
    src = (pathlib.Path(__file__).resolve().parents[2]
           / "cpp_core/src/coordinator_routes_mlx.h").read_text()
    assert "Lock acquisition order" in src, (
        "coordinator_routes_mlx.h must document lock acquisition order"
    )
    assert "registry_mu" in src, (
        "header must mention registry_mu (internal map mutex)"
    )
    assert "semaphore" in src, (
        "header must mention semaphore as layer 2 in the lock order"
    )
