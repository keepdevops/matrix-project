"""#297 integration test — proves ModelRegistry::evict_idle() is actually CALLED
from the request path (the original bug: it was dead code, never invoked, so
resident in-process models were never reclaimed).

Unlike the unit test (tests/cpp/test_model_registry.cpp, which only checks the
eviction *decision* predicate), this drives a live coordinator end-to-end:

  1. submit request #1  → loads + generates a model in-process (gen_calls > 0,
                           model becomes resident)
  2. let it go idle past coord.model_idle_secs
  3. submit request #2  → the submit route calls evict_idle(model_idle_secs())
                           at entry, which reclaims the now-idle model #1 and
                           publishes an "MLX model evicted: … reason=idle" event
  4. assert a NEW reason=idle eviction event appears in /api/rss/history

If the call site is removed again (the #297 regression), step 4 fails.

This requires real MLX inference, so it is OPT-IN and skips gracefully unless the
environment is set up for it.

Run:
  - Build the coordinator with MATRIX_MLX_INPROC=1 (embeds CPython + mlx_lm).
  - swarm-config.json must have: rss.enabled=true, a small
    coord.model_idle_secs (0–2 recommended), and at least one mlx agent with
    dispatch:"inproc".
  - Start the coordinator, then:
        MATRIX_MLX_INTEGRATION=1 \
        MATRIX_COORD_URL=http://localhost:3002 \
        MATRIX_MLX_MODEL_IDLE_SECS=2 \
        pytest tests/mlx_coordinator/test_mlx_inproc_eviction.py -v
"""
from __future__ import annotations

import os
import socket
import time

import pytest
import requests

COORD_URL = os.environ.get("MATRIX_COORD_URL", "http://localhost:3002")
# Coordinator's configured coord.model_idle_secs. The test sleeps this + a
# buffer so model #1 is provably idle before request #2 triggers eviction.
IDLE_SECS = int(os.environ.get("MATRIX_MLX_MODEL_IDLE_SECS", "2"))
SUBMIT_TIMEOUT = int(os.environ.get("MATRIX_MLX_SUBMIT_TIMEOUT", "120"))

EVICT_MARKER = "MLX model evicted:"
IDLE_REASON = "reason=idle"


def _coord_reachable() -> bool:
    try:
        host = COORD_URL.split("//")[-1].split(":")[0]
        port_str = COORD_URL.split(":")[-1].split("/")[0]
        port = int(port_str) if port_str.isdigit() else 3002
        with socket.create_connection((host, port), timeout=1):
            return True
    except OSError:
        return False


def _history_feed() -> str:
    """RSS history feed XML, or '' if the feed route is absent (RSS disabled)."""
    try:
        r = requests.get(f"{COORD_URL}/api/rss/history", timeout=5)
    except requests.RequestException:
        return ""
    if r.status_code != 200:
        return ""
    return r.text


def _idle_evict_count(feed_xml: str) -> int:
    """Count reason=idle model-eviction items in a history feed."""
    n = 0
    # Each <item> with the evict marker AND reason=idle counts once. Crude but
    # robust: split on the marker and check the following description text.
    parts = feed_xml.split(EVICT_MARKER)
    for tail in parts[1:]:
        # The description (with reason=idle) follows shortly after the title.
        if IDLE_REASON in tail[:400]:
            n += 1
    return n


def _resident_count() -> int:
    try:
        r = requests.get(f"{COORD_URL}/api/mlx/pressure", timeout=5)
        if r.status_code != 200:
            return -1
        return int(r.json().get("resident_count", 0))
    except (requests.RequestException, ValueError):
        return -1


def _submit(prompt: str, session_id: str) -> requests.Response:
    return requests.post(
        f"{COORD_URL}/api/mlx/submit",
        json={"prompt": prompt, "session_id": session_id},
        timeout=SUBMIT_TIMEOUT,
    )


@pytest.fixture(scope="module")
def live_inproc_coord():
    """Skip the module unless a real in-process-MLX coordinator is available."""
    if not os.environ.get("MATRIX_MLX_INTEGRATION"):
        pytest.skip("set MATRIX_MLX_INTEGRATION=1 to run the live MLX eviction test")
    if not _coord_reachable():
        pytest.skip(f"coordinator not reachable at {COORD_URL}")
    # The feed route returns RSS XML (non-empty, contains '<rss') when enabled,
    # and 404 → '' here when rss.enabled is false.
    if "<rss" not in _history_feed():
        pytest.skip("RSS history feed unavailable — set rss.enabled=true")
    return COORD_URL


def test_evict_idle_is_called_from_submit_route(live_inproc_coord):
    baseline = _idle_evict_count(_history_feed())

    # 1. Warm a model in-process.
    r1 = _submit("ping", session_id="evict-it-1")
    if r1.status_code == 501:
        pytest.skip("/api/mlx/submit is a stub in this build (MS-133 not merged)")
    assert r1.status_code == 200, f"submit #1 failed: {r1.status_code} {r1.text[:200]}"

    # Confirm the build actually loaded a resident in-process model; if not, this
    # isn't an INPROC build or the agent isn't dispatch:inproc — skip, don't fail.
    resident = _resident_count()
    if resident <= 0:
        pytest.skip(
            "no resident in-process model after submit — build without "
            "MATRIX_MLX_INPROC or no dispatch:inproc agent; eviction wiring "
            "cannot be exercised"
        )

    # 2. Let model #1 go idle past coord.model_idle_secs.
    time.sleep(IDLE_SECS + 2)

    # 3. Second request — its evict_idle() at route entry must reclaim model #1.
    r2 = _submit("pong", session_id="evict-it-2")
    assert r2.status_code == 200, f"submit #2 failed: {r2.status_code} {r2.text[:200]}"

    # 4. A new reason=idle eviction event must have been published. Poll briefly
    #    since RSS publish + request completion are concurrent.
    deadline = time.time() + 15
    after = baseline
    while time.time() < deadline:
        after = _idle_evict_count(_history_feed())
        if after > baseline:
            break
        time.sleep(1)

    assert after > baseline, (
        f"no new '{EVICT_MARKER} … {IDLE_REASON}' event after the second submit "
        f"(baseline={baseline}, after={after}). evict_idle() appears not to be "
        f"called from the /api/mlx/submit route — the #297 regression."
    )
