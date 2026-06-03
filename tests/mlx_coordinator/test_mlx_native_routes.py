"""MS-132 smoke tests — native C++ /api/mlx/* stub routes.

Verifies that when the coordinator is built with MATRIX_MLX_NATIVE_COORD=1
every /api/mlx/* route returns HTTP 501 with a JSON body that identifies
the route and the MS issue that will implement it.

Requires:
  - Coordinator binary built with MATRIX_MLX_NATIVE_COORD=1
  - Coordinator running on MATRIX_COORD_URL (default http://localhost:3002)

Skip conditions (all graceful, not failures):
  - Coordinator not reachable (network / not started)
  - Coordinator built without MATRIX_MLX_NATIVE_COORD=1 (returns 404)
"""
from __future__ import annotations

import os
import socket

import pytest
import requests

COORD_URL = os.environ.get("MATRIX_COORD_URL", "http://localhost:3002")


# ---------------------------------------------------------------------------
# Connectivity fixture
# ---------------------------------------------------------------------------

def _coord_reachable() -> bool:
    try:
        host = COORD_URL.split("//")[-1].split(":")[0]
        port_str = COORD_URL.split(":")[-1].split("/")[0]
        port = int(port_str) if port_str.isdigit() else 3002
        with socket.create_connection((host, port), timeout=1):
            return True
    except OSError:
        return False


@pytest.fixture(scope="module")
def coord():
    """Skip entire module if coordinator is not reachable."""
    if not _coord_reachable():
        pytest.skip(f"Coordinator not reachable at {COORD_URL}")
    return COORD_URL


def _expect_501(coord_url: str, method: str, path: str) -> None:
    """Assert that method+path returns 501 with a JSON error body.
    Skip (not fail) if 404 — coordinator built without the MLX flag."""
    url = f"{coord_url}{path}"
    fn = requests.get if method == "GET" else requests.post
    resp = fn(url, timeout=5, json={})
    if resp.status_code == 404:
        pytest.skip(
            f"{method} {path} → 404; coordinator built without "
            "MATRIX_MLX_NATIVE_COORD=1 — rebuild with the flag to run this test"
        )
    assert resp.status_code == 501, (
        f"{method} {path} expected 501, got {resp.status_code}: {resp.text[:200]}"
    )
    body = resp.json()
    assert "error" in body, f"Missing 'error' key in response: {body}"
    assert "route" in body, f"Missing 'route' key in response: {body}"
    assert "not implemented" in body["error"].lower(), (
        f"Unexpected error message: {body['error']!r}"
    )


# ---------------------------------------------------------------------------
# MS-133: POST /api/mlx/submit live contract tests
# ---------------------------------------------------------------------------

def _submit(coord_url: str, **json_body):
    """Helper: POST /api/mlx/submit and return the response."""
    return requests.post(f"{coord_url}/api/mlx/submit", json=json_body, timeout=10)


def test_mlx_submit_bad_json_returns_400(coord):
    """POST /api/mlx/submit with malformed JSON → 400."""
    resp = requests.post(
        f"{coord}/api/mlx/submit",
        data="bad",
        headers={"Content-Type": "application/json"},
        timeout=5,
    )
    if resp.status_code == 501:
        pytest.skip("submit still a stub — MS-133 not yet merged")
    assert resp.status_code == 400, f"expected 400, got {resp.status_code}"


def test_mlx_submit_empty_prompt_returns_400(coord):
    """POST /api/mlx/submit with whitespace-only prompt → 400."""
    resp = _submit(coord, prompt="   ")
    if resp.status_code == 501:
        pytest.skip("submit still a stub")
    assert resp.status_code == 400


def test_mlx_submit_missing_prompt_returns_400(coord):
    """POST /api/mlx/submit with no prompt key → 400."""
    resp = requests.post(f"{coord}/api/mlx/submit", json={}, timeout=5)
    if resp.status_code == 501:
        pytest.skip("submit still a stub")
    assert resp.status_code == 400


def test_mlx_submit_returns_result_and_session_id(coord):
    """POST /api/mlx/submit with valid prompt → 200 with result + session_id."""
    resp = _submit(coord, prompt="hello world")
    if resp.status_code == 501:
        pytest.skip("submit still a stub")
    if resp.status_code == 503:
        pytest.skip("no MLX agents configured in this coordinator")
    assert resp.status_code == 200, f"expected 200, got {resp.status_code}: {resp.text[:200]}"
    body = resp.json()
    assert "result" in body, f"'result' missing from response: {body}"
    assert "session_id" in body, f"'session_id' missing from response: {body}"
    assert isinstance(body["result"], str)
    assert isinstance(body["session_id"], str)
    assert body["session_id"]  # non-empty


def test_mlx_submit_preserves_caller_session_id(coord):
    """POST /api/mlx/submit with session_id → response echoes same session_id."""
    resp = _submit(coord, prompt="hi", session_id="caller-session-42")
    if resp.status_code in (501, 503):
        pytest.skip("submit stub or no MLX agents")
    assert resp.status_code == 200
    assert resp.json()["session_id"] == "caller-session-42"


def test_mlx_submit_generates_session_id_when_absent(coord):
    """POST /api/mlx/submit without session_id → response has a generated one."""
    resp = _submit(coord, prompt="generate me a session")
    if resp.status_code in (501, 503):
        pytest.skip("submit stub or no MLX agents")
    assert resp.status_code == 200
    sid = resp.json().get("session_id", "")
    assert sid.startswith("mlx"), f"expected mlx-prefixed session_id, got {sid!r}"


# ---------------------------------------------------------------------------
# MS-132 stub route tests (other routes still 501)
# ---------------------------------------------------------------------------

def test_mlx_submit_stub_501(coord):
    """POST /api/mlx/submit → 501 when MS-133 not implemented.
    Skipped automatically if submit is already implemented (returns 200/400/503)."""
    resp = requests.post(f"{coord}/api/mlx/submit", json={"prompt": "x"}, timeout=5)
    if resp.status_code != 501:
        pytest.skip(f"submit is implemented (status {resp.status_code}), not a stub")


# ---------------------------------------------------------------------------
# MS-136: POST /api/mlx/stream live contract tests
# ---------------------------------------------------------------------------

def _stream_body(coord_url: str, **json_body) -> tuple[requests.Response, str]:
    """POST /api/mlx/stream with streaming=True; returns (response, full_body)."""
    resp = requests.post(
        f"{coord_url}/api/mlx/stream", json=json_body,
        stream=True, timeout=15,
    )
    body = "".join(c.decode() for c in resp.iter_content(chunk_size=None))
    return resp, body


def test_mlx_stream_bad_json_returns_400(coord):
    resp = requests.post(
        f"{coord}/api/mlx/stream", data="bad",
        headers={"Content-Type": "application/json"}, timeout=5,
    )
    if resp.status_code == 501:
        pytest.skip("stream still a stub")
    assert resp.status_code == 400


def test_mlx_stream_empty_prompt_returns_400(coord):
    resp = requests.post(f"{coord}/api/mlx/stream", json={"prompt": "   "}, timeout=5)
    if resp.status_code == 501:
        pytest.skip("stream still a stub")
    assert resp.status_code == 400


def test_mlx_stream_returns_event_stream_content_type(coord):
    resp, _ = _stream_body(coord, prompt="hello")
    if resp.status_code == 501:
        pytest.skip("stream still a stub")
    if resp.status_code == 503:
        pytest.skip("no MLX agents configured")
    assert resp.status_code == 200
    assert "text/event-stream" in resp.headers.get("Content-Type", "")


def test_mlx_stream_x_session_id_header_present(coord):
    resp, _ = _stream_body(coord, prompt="hello")
    if resp.status_code in (501, 503):
        pytest.skip("stub or no MLX agents")
    assert resp.headers.get("X-Session-Id"), "X-Session-Id header missing"


def test_mlx_stream_session_id_echoed(coord):
    resp, _ = _stream_body(coord, prompt="hi", session_id="echo-me-42")
    if resp.status_code in (501, 503):
        pytest.skip("stub or no MLX agents")
    assert resp.headers.get("X-Session-Id") == "echo-me-42"


def test_mlx_stream_emits_token_event(coord):
    _, body = _stream_body(coord, prompt="hello")
    if "501" in body or not body:
        pytest.skip("stub or no MLX agents")
    assert "event: token" in body, f"'event: token' not found in:\n{body[:400]}"


def test_mlx_stream_emits_done_event(coord):
    _, body = _stream_body(coord, prompt="hello")
    if "501" in body or not body:
        pytest.skip("stub or no MLX agents")
    assert "event: done" in body, f"'event: done' not found in:\n{body[:400]}"


def test_mlx_stream_emits_agent_start_and_end(coord):
    _, body = _stream_body(coord, prompt="hello")
    if "501" in body or not body:
        pytest.skip("stub or no MLX agents")
    assert "event: agent_start" in body
    assert "event: agent_end" in body


def test_mlx_stream_stub_501(coord):
    """POST /api/mlx/stream → 501 when MS-136 not yet implemented."""
    resp = requests.post(f"{coord}/api/mlx/stream", json={"prompt": "x"}, timeout=5)
    if resp.status_code != 501:
        pytest.skip(f"stream is implemented (status {resp.status_code})")


# ---------------------------------------------------------------------------
# MS-137: mode switch + pipeline/cascade ordered events
# ---------------------------------------------------------------------------

def _set_mode(coord_url: str, mode: str) -> None:
    requests.post(f"{coord_url}/api/mlx/modes/active", json={"mode": mode}, timeout=5)


def test_mlx_modes_get_shape(coord):
    """GET /api/mlx/modes returns {modes: list, active: str}."""
    resp = requests.get(f"{coord}/api/mlx/modes", timeout=5)
    if resp.status_code == 501:
        pytest.skip("modes still a stub")
    assert resp.status_code == 200
    body = resp.json()
    assert "modes" in body and "active" in body
    assert isinstance(body["modes"], list)
    assert body["active"] in body["modes"]


def test_mlx_modes_default_is_flat(coord):
    """Default active mode is flat."""
    _set_mode(coord, "flat")  # reset in case a previous test left it changed
    resp = requests.get(f"{coord}/api/mlx/modes", timeout=5)
    if resp.status_code == 501:
        pytest.skip("modes still a stub")
    assert resp.json()["active"] == "flat"


def test_mlx_modes_active_set_pipeline(coord):
    """POST /api/mlx/modes/active {mode: pipeline} → 200 {active: pipeline}."""
    resp = requests.post(f"{coord}/api/mlx/modes/active",
                         json={"mode": "pipeline"}, timeout=5)
    if resp.status_code == 501:
        pytest.skip("modes/active still a stub")
    assert resp.status_code == 200
    assert resp.json().get("active") == "pipeline"
    # verify GET reflects change
    check = requests.get(f"{coord}/api/mlx/modes", timeout=5)
    assert check.json()["active"] == "pipeline"
    _set_mode(coord, "flat")  # restore


def test_mlx_modes_active_invalid_returns_400(coord):
    """POST /api/mlx/modes/active with unknown mode → 400."""
    resp = requests.post(f"{coord}/api/mlx/modes/active",
                         json={"mode": "turbo"}, timeout=5)
    if resp.status_code == 501:
        pytest.skip("modes/active still a stub")
    assert resp.status_code == 400


def test_mlx_modes_active_set_cascade(coord):
    """POST /api/mlx/modes/active {mode: cascade} → 200."""
    resp = requests.post(f"{coord}/api/mlx/modes/active",
                         json={"mode": "cascade"}, timeout=5)
    if resp.status_code == 501:
        pytest.skip("modes/active still a stub")
    assert resp.status_code == 200
    assert resp.json().get("active") == "cascade"
    _set_mode(coord, "flat")  # restore


def test_mlx_pipeline_stream_emits_ordered_events(coord):
    """Pipeline mode: agent_start → token → agent_end in sequential order."""
    _set_mode(coord, "pipeline")
    resp, body = _stream_body(coord, prompt="pipeline test")
    _set_mode(coord, "flat")
    if resp.status_code in (501, 503):
        pytest.skip("stub or no MLX agents")
    assert "event: agent_start" in body
    assert "event: agent_end"   in body
    assert "event: done"        in body
    # agent_start must appear before agent_end in the body
    assert body.index("event: agent_start") < body.index("event: agent_end")


def test_mlx_modes_stub_501(coord):
    """GET /api/mlx/modes → 501 when MS-137 not yet implemented."""
    resp = requests.get(f"{coord}/api/mlx/modes", timeout=5)
    if resp.status_code != 501:
        pytest.skip(f"modes is implemented (status {resp.status_code})")
    _expect_501(coord, "GET", "/api/mlx/modes")


def test_mlx_modes_active_stub_501(coord):
    """POST /api/mlx/modes/active → 501 when MS-137 not yet implemented."""
    resp = requests.post(f"{coord}/api/mlx/modes/active",
                         json={"mode": "flat"}, timeout=5)
    if resp.status_code != 501:
        pytest.skip(f"modes/active is implemented (status {resp.status_code})")
    _expect_501(coord, "POST", "/api/mlx/modes/active")


# ---------------------------------------------------------------------------
# MS-134: health + pressure live contract tests
# ---------------------------------------------------------------------------

def test_mlx_health_shape(coord):
    """GET /api/mlx/health returns {ok, backends} — 200 or 503."""
    resp = requests.get(f"{coord}/api/mlx/health", timeout=5)
    if resp.status_code == 501:
        pytest.skip("health still a stub")
    assert resp.status_code in (200, 503), f"unexpected {resp.status_code}"
    body = resp.json()
    assert "ok" in body, f"'ok' missing: {body}"
    assert "backends" in body, f"'backends' missing: {body}"
    assert isinstance(body["ok"], bool)
    assert isinstance(body["backends"], dict)


def test_mlx_health_backend_entries_have_ok_and_detail(coord):
    """Each backends entry has ok (bool) and detail (str)."""
    resp = requests.get(f"{coord}/api/mlx/health", timeout=5)
    if resp.status_code == 501:
        pytest.skip("health still a stub")
    for name, entry in resp.json().get("backends", {}).items():
        assert "ok" in entry, f"backend {name!r} missing 'ok'"
        assert "detail" in entry, f"backend {name!r} missing 'detail'"
        assert isinstance(entry["ok"], bool)
        assert isinstance(entry["detail"], str)


def test_mlx_health_overall_ok_matches_backends(coord):
    """Top-level ok == all(backend.ok for backend in backends)."""
    resp = requests.get(f"{coord}/api/mlx/health", timeout=5)
    if resp.status_code == 501:
        pytest.skip("health still a stub")
    body = resp.json()
    backends = body.get("backends", {})
    if not backends:
        assert body["ok"] is True  # empty set → healthy
    else:
        expected_ok = all(e["ok"] for e in backends.values())
        assert body["ok"] == expected_ok


def test_mlx_pressure_shape(coord):
    """GET /api/mlx/pressure returns {inflight: dict, sessions: list}."""
    resp = requests.get(f"{coord}/api/mlx/pressure", timeout=5)
    if resp.status_code == 501:
        pytest.skip("pressure still a stub")
    assert resp.status_code == 200
    body = resp.json()
    assert "inflight" in body, f"'inflight' missing: {body}"
    assert "sessions" in body, f"'sessions' missing: {body}"
    assert isinstance(body["inflight"], dict)
    # sessions is a snapshot list after MS-138 (parity with Python handle_pressure)
    assert isinstance(body["sessions"], list)


def test_mlx_pressure_inflight_values_are_non_negative(coord):
    """All inflight port values are non-negative integers."""
    resp = requests.get(f"{coord}/api/mlx/pressure", timeout=5)
    if resp.status_code == 501:
        pytest.skip("pressure still a stub")
    for port_key, count in resp.json().get("inflight", {}).items():
        assert isinstance(count, int), f"port {port_key} count not int: {count}"
        assert count >= 0, f"port {port_key} count negative: {count}"


# Old stubs — auto-skip when implemented
def test_mlx_health_stub_501(coord):
    """GET /api/mlx/health → 501 when MS-134 not yet implemented."""
    resp = requests.get(f"{coord}/api/mlx/health", timeout=5)
    if resp.status_code != 501:
        pytest.skip(f"health is implemented (status {resp.status_code})")


def test_mlx_pressure_stub_501(coord):
    """GET /api/mlx/pressure → 501 when MS-134 not yet implemented."""
    resp = requests.get(f"{coord}/api/mlx/pressure", timeout=5)
    if resp.status_code != 501:
        pytest.skip(f"pressure is implemented (status {resp.status_code})")


# ---------------------------------------------------------------------------
# MS-139: GET /api/mlx/agents live contract tests
# ---------------------------------------------------------------------------

def test_mlx_agents_returns_dict(coord):
    """GET /api/mlx/agents → 200, dict keyed by agent name."""
    resp = requests.get(f"{coord}/api/mlx/agents", timeout=5)
    if resp.status_code == 501:
        pytest.skip("agents still a stub")
    assert resp.status_code == 200
    body = resp.json()
    assert isinstance(body, dict), f"expected dict, got {type(body)}: {body}"


def test_mlx_agents_entries_have_required_keys(coord):
    """Each agent entry has port, engine, model."""
    resp = requests.get(f"{coord}/api/mlx/agents", timeout=5)
    if resp.status_code == 501:
        pytest.skip("agents still a stub")
    for name, entry in resp.json().items():
        for key in ("port", "engine", "model"):
            assert key in entry, f"agent {name!r} missing {key!r}: {entry}"
        assert entry["engine"] == "mlx", f"non-MLX agent in response: {name}"


def test_mlx_agents_stub_501(coord):
    """GET /api/mlx/agents → 501 when MS-139 not yet implemented."""
    resp = requests.get(f"{coord}/api/mlx/agents", timeout=5)
    if resp.status_code != 501:
        pytest.skip(f"agents is implemented (status {resp.status_code})")
    _expect_501(coord, "GET", "/api/mlx/agents")


# test_mlx_modes_stub_501 and test_mlx_modes_active_stub_501 moved to
# the MS-137 section above with auto-skip guards.


# ---------------------------------------------------------------------------
# MS-140: POST /api/mlx/session/clear live contract tests
# ---------------------------------------------------------------------------

def test_mlx_session_clear_specific(coord):
    """POST /api/mlx/session/clear {session_id} → {cleared: [sid]} or {cleared: []}."""
    # seed a session
    requests.post(f"{coord}/api/mlx/submit",
                  json={"prompt": "hi", "session_id": "ms140-seed"}, timeout=10)
    resp = requests.post(f"{coord}/api/mlx/session/clear",
                         json={"session_id": "ms140-seed"}, timeout=5)
    if resp.status_code == 501:
        pytest.skip("session/clear still a stub")
    if resp.status_code == 503:
        pytest.skip("no MLX agents; submit couldn't seed a session")
    assert resp.status_code == 200
    body = resp.json()
    assert "cleared" in body, f"'cleared' key missing: {body}"
    assert isinstance(body["cleared"], list)


def test_mlx_session_clear_all(coord):
    """POST /api/mlx/session/clear {} → {cleared_count: N}."""
    resp = requests.post(f"{coord}/api/mlx/session/clear", json={}, timeout=5)
    if resp.status_code == 501:
        pytest.skip("session/clear still a stub")
    assert resp.status_code == 200
    body = resp.json()
    assert "cleared_count" in body, f"'cleared_count' key missing: {body}"
    assert isinstance(body["cleared_count"], int)
    assert body["cleared_count"] >= 0


def test_mlx_session_clear_unknown_returns_empty(coord):
    """Clearing a non-existent session returns cleared: []."""
    resp = requests.post(f"{coord}/api/mlx/session/clear",
                         json={"session_id": "nonexistent-xyz"}, timeout=5)
    if resp.status_code == 501:
        pytest.skip("session/clear still a stub")
    assert resp.status_code == 200
    assert resp.json().get("cleared") == []


def test_mlx_session_clear_bad_json_returns_400(coord):
    """POST /api/mlx/session/clear with bad JSON → 400."""
    resp = requests.post(f"{coord}/api/mlx/session/clear", data="bad",
                         headers={"Content-Type": "application/json"}, timeout=5)
    if resp.status_code == 501:
        pytest.skip("session/clear still a stub")
    assert resp.status_code == 400


def test_mlx_session_clear_stub_501(coord):
    """POST /api/mlx/session/clear → 501 when MS-140 not yet implemented."""
    resp = requests.post(f"{coord}/api/mlx/session/clear", json={}, timeout=5)
    if resp.status_code != 501:
        pytest.skip(f"session/clear is implemented (status {resp.status_code})")
    _expect_501(coord, "POST", "/api/mlx/session/clear")


# ---------------------------------------------------------------------------
# MS-132: flag-off guard — /api/mlx/* must not exist without the flag
# ---------------------------------------------------------------------------

def test_mlx_routes_absent_without_flag_documented():
    """Static assertion: coordinator_routes.cpp gates registration on the flag."""
    import pathlib
    src = (
        pathlib.Path(__file__).resolve().parents[2]
        / "cpp_core/src/coordinator_routes.cpp"
    ).read_text()
    assert "MATRIX_MLX_NATIVE_COORD" in src, (
        "coordinator_routes.cpp must guard MLX registration with "
        "#ifdef MATRIX_MLX_NATIVE_COORD"
    )
    assert "register_coordinator_routes_mlx" in src, (
        "coordinator_routes.cpp must call register_coordinator_routes_mlx"
    )


def test_mlx_route_header_has_port_mutex():
    """Static assertion: coordinator_routes_mlx.h exports the per-port mutex."""
    import pathlib
    src = (
        pathlib.Path(__file__).resolve().parents[2]
        / "cpp_core/src/coordinator_routes_mlx.h"
    ).read_text()
    assert "port_mutex" in src, (
        "coordinator_routes_mlx.h must define mlx_coordinator::port_mutex"
    )
    assert "std::mutex" in src, (
        "coordinator_routes_mlx.h must use std::mutex for per-port serialisation"
    )


def test_all_parity_routes_have_stubs():
    """Static assertion: all routes from the parity matrix have stub handlers."""
    import pathlib
    src = (
        pathlib.Path(__file__).resolve().parents[2]
        / "cpp_core/src/coordinator_routes_mlx.cpp"
    ).read_text()
    routes = [
        "/api/mlx/submit",
        "/api/mlx/stream",
        "/api/mlx/health",
        "/api/mlx/pressure",
        "/api/mlx/agents",
        "/api/mlx/modes",
        "/api/mlx/modes/active",
        "/api/mlx/session/clear",
    ]
    for route in routes:
        assert route in src, f"Stub missing for route: {route}"


# ---------------------------------------------------------------------------
# MS-148: connection pool + SSE parser static assertions
# ---------------------------------------------------------------------------

def test_ms148_stream_mlx_uses_sse_parser():
    """MS-148: agent_stream_llama.h must define stream_mlx (SSE streaming)."""
    import pathlib
    src = (pathlib.Path(__file__).resolve().parents[2]
           / "cpp_core/src/agent_stream_llama.h").read_text()
    assert "stream_mlx" in src and "stream=true" in src, (
        "agent_stream_llama.h must define stream_mlx with stream=true"
    )
    assert "drain_frames" in src, (
        "stream_mlx must use sse::drain_frames for incremental token delivery"
    )
    assert "stream_pool_checkout" in src, (
        "stream_mlx must use stream_pool_checkout for connection reuse"
    )
    assert "stream_pool_checkin" in src, (
        "stream_mlx must return connections to stream pool on success"
    )
    assert "record_completion" in src, (
        "stream_mlx must call mlx_inflight::record_completion for EMA telemetry"
    )


def test_ms148_stream_agent_routes_mlx_to_stream_mlx():
    """MS-148: agent_stream.cpp must call stream_mlx (not stream_mlx_oneshot)."""
    import pathlib
    src = (pathlib.Path(__file__).resolve().parents[2]
           / "cpp_core/src/agent_stream.cpp").read_text()
    assert "stream_mlx(" in src, (
        "agent_stream.cpp must dispatch MLX to stream_mlx (SSE streaming)"
    )
    # stream_mlx is the call; stream_mlx_oneshot may appear as a comment reference
    assert "return stream_mlx(" in src, (
        "stream_agent must return stream_mlx(...) for non-llama engines"
    )


def test_ms148_health_uses_connection_pool():
    """MS-148: health endpoint must use pool_checkout/pool_checkin."""
    import pathlib
    src = (pathlib.Path(__file__).resolve().parents[2]
           / "cpp_core/src/coordinator_routes_mlx.cpp").read_text()
    # Health endpoint section
    health_section = src[src.index("/api/mlx/health"):]
    assert "pool_checkout" in health_section, (
        "health endpoint must use pool_checkout for keep-alive connection reuse"
    )
    assert "pool_checkin" in health_section, (
        "health endpoint must return connections via pool_checkin"
    )
