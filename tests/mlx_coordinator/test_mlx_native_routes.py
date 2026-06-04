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
    # Check the response header only — no need to consume the full body.
    # X-Session-Id is set before the chunked SSE content starts.
    resp = requests.post(f"{coord}/api/mlx/stream", json={"prompt": "hello"},
                         stream=True, timeout=15)
    if resp.status_code in (501, 503):
        resp.close()
        pytest.skip("stub or no MLX agents")
    header = resp.headers.get("X-Session-Id", "")
    resp.close()
    assert header, "X-Session-Id header missing"


def test_mlx_stream_session_id_echoed(coord):
    # Check the response header only — no need to consume the full body.
    resp = requests.post(f"{coord}/api/mlx/stream",
                         json={"prompt": "hi", "session_id": "echo-me-42"},
                         stream=True, timeout=15)
    if resp.status_code in (501, 503):
        resp.close()
        pytest.skip("stub or no MLX agents")
    header = resp.headers.get("X-Session-Id", "")
    resp.close()
    assert header == "echo-me-42", f"expected 'echo-me-42', got {header!r}"


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


def test_mlx_cascade_stream_emits_synthesis_start(coord):
    """MS-137: cascade mode emits synthesis_start before synthesizer tokens.

    Single-agent cascade degrades to flat (no synthesizer), so this test
    requires ≥2 MLX agents in the roster — skips otherwise.
    """
    agents_resp = requests.get(f"{coord}/api/mlx/agents", timeout=5)
    if agents_resp.status_code != 200 or len(agents_resp.json()) < 2:
        pytest.skip("cascade synthesizer needs ≥2 MLX agents; degrades to flat otherwise")

    _set_mode(coord, "cascade")
    resp, body = _stream_body(coord, prompt="cascade synthesis test")
    _set_mode(coord, "flat")
    if resp.status_code in (501, 503):
        pytest.skip("stub or no MLX agents")
    assert resp.status_code == 200
    assert "event: synthesis_start" in body
    assert "event: agent_start"     in body
    assert "event: done"            in body
    # synthesis_start must precede the done event
    assert body.index("event: synthesis_start") < body.index("event: done")


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


# ---------------------------------------------------------------------------
# MS-69 Phase B — RSS publish hooks in model_registry_embed.cpp
# ---------------------------------------------------------------------------

def test_ms69b_rss_header_included():
    """MS-69B: model_registry_embed.cpp must include rss_generator.h."""
    import pathlib
    src = (pathlib.Path(__file__).resolve().parents[2]
           / "cpp_core/src/model_registry_embed.cpp").read_text()
    assert '#include "rss_generator.h"' in src, (
        "model_registry_embed.cpp must include rss_generator.h for RSS hooks"
    )


def test_ms69b_publish_on_first_load():
    """MS-69B: note_generation() must publish an RSS event on first model load (gen_calls==0)."""
    import pathlib
    src = (pathlib.Path(__file__).resolve().parents[2]
           / "cpp_core/src/model_registry_embed.cpp").read_text()
    assert "first_load" in src, (
        "note_generation must detect first load via gen_calls==0"
    )
    assert "MLX model loaded:" in src, (
        "note_generation must publish 'MLX model loaded:' RSS event"
    )


def test_ms69b_publish_on_eviction():
    """MS-69B: evict_idle() must publish an RSS event per evicted model."""
    import pathlib
    src = (pathlib.Path(__file__).resolve().parents[2]
           / "cpp_core/src/model_registry_embed.cpp").read_text()
    assert "MLX model evicted:" in src, (
        "evict_idle must publish 'MLX model evicted:' RSS event for each stale key"
    )
    assert "reason=idle" in src, (
        "eviction RSS event must include reason=idle"
    )


# ---------------------------------------------------------------------------
# MS-70 — TES + history entry _meta persistence
# ---------------------------------------------------------------------------

def test_ms70_dispatch_history_persists_meta():
    """MS-70: dispatch_write_history must save envelope['meta'] as entry['_meta']."""
    import pathlib
    src = (pathlib.Path(__file__).resolve().parents[2]
           / "cpp_core/src/coordinator_routes_dispatch_history.h").read_text()
    assert '"_meta"' in src and 'envelope["meta"]' in src, (
        "dispatch_write_history must copy envelope['meta'] → entry['_meta'] "
        "so TES and token_budget survive history reload"
    )


def test_ms70_history_utils_exists():
    """MS-70: src/utils/historyUtils.js must exist with enrichEntry and extractMetaSummary."""
    import pathlib
    p = pathlib.Path(__file__).resolve().parents[2] / "src/utils/historyUtils.js"
    assert p.exists(), "src/utils/historyUtils.js must exist (MS-70)"
    src = p.read_text()
    assert "enrichEntry" in src, "historyUtils must export enrichEntry"
    assert "extractMetaSummary" in src, "historyUtils must export extractMetaSummary"


def test_ms70_tes_stamped_in_dispatch_meta():
    """MS-70: coordinator_routes_dispatch_meta.h must stamp meta.tes after token_budget."""
    import pathlib
    src = (pathlib.Path(__file__).resolve().parents[2]
           / "cpp_core/src/coordinator_routes_dispatch_meta.h").read_text()
    assert 'tes::compute' in src, "dispatch_meta must call tes::compute()"
    assert '"tes"' in src, "dispatch_meta must write meta['tes']"


# ---------------------------------------------------------------------------
# MS-72 — Streaming token accounting + TES onTes callback
# ---------------------------------------------------------------------------

def test_ms72_stream_llama_captures_last_data():
    """MS-72: stream_llama must capture last_data for timings/usage parsing."""
    import pathlib
    src = (pathlib.Path(__file__).resolve().parents[2]
           / "cpp_core/src/agent_stream_llama.h").read_text()
    assert "last_data" in src, (
        "stream_llama must capture last non-DONE data: payload in last_data"
    )
    assert "tokens_evaluated" in src, (
        "stream_llama must extract tokens_evaluated from timings"
    )
    assert "tokens_predicted" in src, (
        "stream_llama must extract tokens_predicted from timings"
    )


def test_ms72_stream_mlx_captures_usage():
    """MS-72: stream_mlx must parse usage.prompt_tokens/completion_tokens."""
    import pathlib
    src = (pathlib.Path(__file__).resolve().parents[2]
           / "cpp_core/src/agent_stream_llama.h").read_text()
    assert "prompt_tokens" in src, (
        "stream_mlx must parse usage.prompt_tokens from final SSE chunk"
    )
    assert "completion_tokens" in src, (
        "stream_mlx must parse usage.completion_tokens from final SSE chunk"
    )


def test_ms72_sse_reader_on_tes_callback():
    """MS-72: sseStreamReader.js must accept and call onTes for meta.tes."""
    import pathlib
    src = (pathlib.Path(__file__).resolve().parents[2]
           / "src/api/sseStreamReader.js").read_text()
    assert "onTes" in src, (
        "readSseStream must accept onTes callback (MS-72)"
    )
    assert "meta.tes" in src or "meta?.tes" in src, (
        "readSseStream must extract meta.tes from session/metrics events"
    )


# ---------------------------------------------------------------------------
# MS-72 — Streaming token accounting + TES propagation
# ---------------------------------------------------------------------------

def test_ms72_stream_llama_records_tokens():
    """MS-72: agent_stream_llama.h must call token_ledger::add after streaming."""
    import pathlib
    src = (pathlib.Path(__file__).resolve().parents[2]
           / "cpp_core/src/agent_stream_llama.h").read_text()
    assert "token_ledger::add" in src, (
        "agent_stream_llama.h must call token_ledger::add after stream completes"
    )
    assert "tokens_evaluated" in src or "tokens_predicted" in src, (
        "agent_stream_llama.h must parse llama-server timings for real token counts"
    )


def test_ms72_sse_reader_exposes_ontes():
    """MS-72: sseStreamReader.js must accept and call onTes callback."""
    import pathlib
    src = (pathlib.Path(__file__).resolve().parents[2]
           / "src/api/sseStreamReader.js").read_text()
    assert "onTes" in src, (
        "sseStreamReader.js readSseStream must accept onTes callback"
    )


def test_ms72_orchestrate_stream_records_tes():
    """MS-72: useOrchestrateStream.js must call onTes with meta.tes on done."""
    import pathlib
    src = (pathlib.Path(__file__).resolve().parents[2]
           / "src/hooks/useOrchestrateStream.js").read_text()
    assert "onTes" in src, (
        "useOrchestrateStream must accept and call onTes for TES sparkline"
    )
    assert "meta" in src and "tes" in src, (
        "useOrchestrateStream must extract meta.tes and forward to onTes"
    )


# ---------------------------------------------------------------------------
# MS-73 — Token Budget Dashboard + overrun hard-stop
# ---------------------------------------------------------------------------

def test_ms73_reject_on_overrun_in_context():
    """MS-73: CoordinatorState must have reject_on_overrun field."""
    import pathlib
    src = (pathlib.Path(__file__).resolve().parents[2]
           / "cpp_core/src/coordinator_context.h").read_text()
    assert "reject_on_overrun" in src, (
        "coordinator_context.h must declare reject_on_overrun in CoordinatorState"
    )


def test_ms73_dispatch_enforces_overrun():
    """MS-73: dispatch route must return 429 when reject_on_overrun and ledger overrun."""
    import pathlib
    src = (pathlib.Path(__file__).resolve().parents[2]
           / "cpp_core/src/coordinator_routes_dispatch.cpp").read_text()
    assert "reject_on_overrun" in src, "dispatch must check reject_on_overrun"
    assert "token_budget_exceeded" in src, "dispatch must return token_budget_exceeded error"


def test_ms73_metrics_json_route_exists():
    """MS-73: GET /api/metrics-json must exist for TokenBudgetDashboard polling."""
    import pathlib
    src = (pathlib.Path(__file__).resolve().parents[2]
           / "cpp_core/src/coordinator_routes_metrics.h").read_text()
    assert "/api/metrics-json" in src, (
        "coordinator_routes_metrics.h must register GET /api/metrics-json"
    )


def test_ms73_brew_session_tab_wires_budget_exhausted():
    """MS-73: BrewSessionTab must pass budgetExhausted from useTokenBudget to PromptInput."""
    import pathlib
    src = (pathlib.Path(__file__).resolve().parents[2]
           / "src/layouts/BrewSessionTab.js").read_text()
    assert "useTokenBudget" in src, "BrewSessionTab must import useTokenBudget"
    assert "budgetExhausted" in src, "BrewSessionTab must pass budgetExhausted to PromptInput"


# ---------------------------------------------------------------------------
# MS-75 — RAG Re-Ranking + Relevance Score UI
# ---------------------------------------------------------------------------

def test_ms75_rag_rerank_header_exists():
    """MS-75: rag_rerank.h must declare term_overlap and rerank functions."""
    import pathlib
    src = (pathlib.Path(__file__).resolve().parents[2]
           / "cpp_core/src/rag_rerank.h").read_text()
    assert "term_overlap" in src, "rag_rerank.h must declare term_overlap()"
    assert "rerank" in src, "rag_rerank.h must declare rerank()"
    assert "ScoredHit" in src or "relevance" in src, (
        "rag_rerank.h must define a scored hit type with relevance field"
    )


def test_ms75_dispatch_prepare_calls_rerank():
    """MS-75: dispatch_prepare must call rag_rerank::rerank when rag_rerank=true."""
    import pathlib
    src = (pathlib.Path(__file__).resolve().parents[2]
           / "cpp_core/src/coordinator_routes_dispatch_prepare.cpp").read_text()
    assert "rag_rerank" in src, "dispatch_prepare must check rag_rerank flag"
    assert "rag_rerank::rerank" in src, "dispatch_prepare must call rag_rerank::rerank()"


def test_ms75_rag_hit_row_shows_relevance_badge():
    """MS-75: RagHitRow must render relevance score badge when hit.relevance present."""
    import pathlib
    src = (pathlib.Path(__file__).resolve().parents[2]
           / "src/components/RagHitRow.js").read_text()
    assert "relevance" in src, "RagHitRow must handle relevance field"


def test_ms75_rag_controls_panel_has_rerank_toggle():
    """MS-75: RagControlsPanel must include ragRerank checkbox."""
    import pathlib
    src = (pathlib.Path(__file__).resolve().parents[2]
           / "src/components/RagControlsPanel.js").read_text()
    assert "ragRerank" in src, "RagControlsPanel must expose ragRerank toggle"


# ---------------------------------------------------------------------------
# MS-76 — History Search + Response Cache Observability
# ---------------------------------------------------------------------------

def test_ms76_cache_metrics_in_prometheus():
    """MS-76: GET /api/metrics must include response cache counters."""
    import pathlib
    src = (pathlib.Path(__file__).resolve().parents[2]
           / "cpp_core/src/coordinator_routes_metrics.h").read_text()
    assert "matrix_cache_hits_total" in src
    assert "matrix_cache_misses_total" in src
    assert "matrix_cache_size" in src
    assert "matrix_cache_evictions_total" in src


def test_ms76_history_search_endpoint():
    """MS-76: coordinator_routes_history_search.h must implement GET /api/history/search."""
    import pathlib
    src = (pathlib.Path(__file__).resolve().parents[2]
           / "cpp_core/src/coordinator_routes_history_search.h").read_text()
    assert "/api/history/search" in src
    assert "history_mutex" in src or "st.history" in src


def test_ms76_history_search_js_exists():
    """MS-76: useHistorySearch.js and HistorySearch.js must exist."""
    import pathlib
    root = pathlib.Path(__file__).resolve().parents[2]
    hook = (root / "src/hooks/useHistorySearch.js").read_text()
    comp = (root / "src/components/HistorySearch.js").read_text()
    assert "searchHistory" in hook or "search" in hook.lower()
    assert "onSelect" in comp or "results" in comp


def test_ms76_cache_stats_bar_exists():
    """MS-76: useCacheStats.js and CacheStatsBar.js must exist."""
    import pathlib
    root = pathlib.Path(__file__).resolve().parents[2]
    hook = (root / "src/hooks/useCacheStats.js").read_text()
    comp = (root / "src/components/CacheStatsBar.js").read_text()
    assert "hit_rate" in hook or "hits" in hook
    assert "hit" in comp.lower()


# ---------------------------------------------------------------------------
# MS-77 — Speculative Decoding Observability + Quality Pass Agent Selector
# ---------------------------------------------------------------------------

def test_ms77_draft_acceptance_prometheus():
    """MS-77: GET /api/metrics must include matrix_agent_draft_acceptance gauge."""
    import pathlib
    src = (pathlib.Path(__file__).resolve().parents[2]
           / "cpp_core/src/coordinator_routes_metrics.h").read_text()
    assert "matrix_agent_draft_acceptance" in src
    assert "matrix_agent_kv_fill" in src


def test_ms77_quality_pass_selector_exists():
    """MS-77: QualityPassSelector.js must exist and emit onTargetChange."""
    import pathlib
    src = (pathlib.Path(__file__).resolve().parents[2]
           / "src/components/QualityPassSelector.js").read_text()
    assert "onTargetChange" in src or "onChange" in src


def test_ms77_submit_handlers_uses_quality_pass_target():
    """MS-77: useSubmitHandlers must accept qualityPassTarget and pass to dispatch."""
    import pathlib
    src = (pathlib.Path(__file__).resolve().parents[2]
           / "src/hooks/useSubmitHandlers.js").read_text()
    assert "qualityPassTarget" in src
    assert "target_agent" in src


# ---------------------------------------------------------------------------
# MS-78 — Mode Preset Import / Export
# ---------------------------------------------------------------------------

def test_ms78_preset_export_endpoint():
    """MS-78: coordinator_routes_presets_url.h must implement GET /api/presets/:name/export."""
    import pathlib
    src = (pathlib.Path(__file__).resolve().parents[2]
           / "cpp_core/src/coordinator_routes_presets_url.h").read_text()
    assert "/export" in src
    assert "Content-Disposition" in src
    assert "attachment" in src


def test_ms78_presets_api_js():
    """MS-78: presetsApi.js must export exportPreset, importPreset, duplicatePreset."""
    import pathlib
    src = (pathlib.Path(__file__).resolve().parents[2]
           / "src/api/presetsApi.js").read_text()
    assert "exportPreset" in src
    assert "importPreset" in src
    assert "duplicatePreset" in src


def test_ms78_preset_import_component():
    """MS-78: PresetImport.js must validate JSON and call importPreset."""
    import pathlib
    src = (pathlib.Path(__file__).resolve().parents[2]
           / "src/components/PresetImport.js").read_text()
    assert "importPreset" in src or "import" in src.lower()
    assert "agents" in src or "synthesizer" in src or "max_select" in src


def test_ms78_preset_actions_component():
    """MS-78: PresetActions.js must expose Export and Duplicate actions."""
    import pathlib
    src = (pathlib.Path(__file__).resolve().parents[2]
           / "src/components/PresetActions.js").read_text()
    assert "export" in src.lower() or "Export" in src
    assert "duplicate" in src.lower() or "Duplicate" in src


# ---------------------------------------------------------------------------
# MS-79 — Conversation Branching (Fork from History Entry)
# ---------------------------------------------------------------------------

def test_ms79_fork_endpoint_exists():
    """MS-79: coordinator_routes_history_fork.h must implement POST /api/history/:run_id/fork."""
    import pathlib
    src = (pathlib.Path(__file__).resolve().parents[2]
           / "cpp_core/src/coordinator_routes_history_fork.h").read_text()
    assert "/fork" in src
    assert "fork_session_id" in src
    assert "session_new_id" in src


def test_ms79_fork_session_hook():
    """MS-79: useForkSession.js must wrap forkSession and return forkResult."""
    import pathlib
    src = (pathlib.Path(__file__).resolve().parents[2]
           / "src/hooks/useForkSession.js").read_text()
    assert "forkSession" in src
    assert "forkResult" in src or "fork_session_id" in src


def test_ms79_fork_button_in_conversation_turn():
    """MS-79: ConversationTurn must render ForkButton when entry._run_id present."""
    import pathlib
    src = (pathlib.Path(__file__).resolve().parents[2]
           / "src/components/ConversationTurn.js").read_text()
    assert "ForkButton" in src
    assert "_run_id" in src


# ---------------------------------------------------------------------------
# MS-80 — Response Diff (A/B Comparison)
# ---------------------------------------------------------------------------

def test_ms80_diff_endpoint_exists():
    """MS-80: coordinator_routes_history_diff.h must implement POST /api/history/diff."""
    import pathlib
    src = (pathlib.Path(__file__).resolve().parents[2]
           / "cpp_core/src/coordinator_routes_history_diff.h").read_text()
    assert "/api/history/diff" in src
    assert "run_id_a" in src and "run_id_b" in src


def test_ms80_word_diff_util():
    """MS-80: wordDiff.js must exist with same/add/remove token types."""
    import pathlib
    src = (pathlib.Path(__file__).resolve().parents[2]
           / "src/utils/wordDiff.js").read_text()
    assert "wordDiff" in src
    assert "same" in src or "add" in src or "remove" in src


def test_ms80_diff_view_component():
    """MS-80: DiffView.js must render word-level diff with textA/textB props."""
    import pathlib
    src = (pathlib.Path(__file__).resolve().parents[2]
           / "src/components/DiffView.js").read_text()
    assert "textA" in src and "textB" in src


def test_ms80_history_diff_hook():
    """MS-80: useHistoryDiff.js must manage entryA/entryB and call diffHistory."""
    import pathlib
    src = (pathlib.Path(__file__).resolve().parents[2]
           / "src/hooks/useHistoryDiff.js").read_text()
    assert "diffHistory" in src
    assert "entryA" in src and "entryB" in src


# ---------------------------------------------------------------------------
# MS-81 — Session Export (Markdown / JSON download)
# ---------------------------------------------------------------------------

def test_ms81_session_export_md_endpoint():
    """MS-81: coordinator_routes_session_export.h must implement export.md and export.json."""
    import pathlib
    src = (pathlib.Path(__file__).resolve().parents[2]
           / "cpp_core/src/coordinator_routes_session_export.h").read_text()
    assert "export.md" in src
    assert "export.json" in src
    assert "Content-Disposition" in src


def test_ms81_session_api_js():
    """MS-81: sessionApi.js must export exportSessionMd and exportSessionJson."""
    import pathlib
    src = (pathlib.Path(__file__).resolve().parents[2]
           / "src/api/sessionApi.js").read_text()
    assert "exportSessionMd" in src
    assert "exportSessionJson" in src


def test_ms81_session_export_buttons():
    """MS-81: SessionExportButtons.js must render MD and JSON download buttons."""
    import pathlib
    src = (pathlib.Path(__file__).resolve().parents[2]
           / "src/components/SessionExportButtons.js").read_text()
    assert "sessionId" in src
    assert "MD" in src or "md" in src.lower()
    assert "JSON" in src or "json" in src.lower()


# ---------------------------------------------------------------------------
# MS-82 — Prompt Templates with Variable Substitution
# ---------------------------------------------------------------------------

def test_ms82_template_routes_exist():
    """MS-82: coordinator_routes_templates.h must implement CRUD + render."""
    import pathlib
    src = (pathlib.Path(__file__).resolve().parents[2]
           / "cpp_core/src/coordinator_routes_templates.h").read_text()
    assert "/api/templates" in src
    assert "/render" in src
    assert "substitute" in src


def test_ms82_template_substitute_util():
    """MS-82: templateSubstitute.js must export substitute and extractVariables."""
    import pathlib
    src = (pathlib.Path(__file__).resolve().parents[2]
           / "src/utils/templateSubstitute.js").read_text()
    assert "substitute" in src
    assert "extractVariables" in src


def test_ms82_template_manager_component():
    """MS-82: TemplateManager.js must render variable form and emit onInsert."""
    import pathlib
    src = (pathlib.Path(__file__).resolve().parents[2]
           / "src/components/TemplateManager.js").read_text()
    assert "onInsert" in src or "variables" in src


def test_ms82_templates_api_js():
    """MS-82: templatesApi.js must export renderTemplate and saveTemplate."""
    import pathlib
    src = (pathlib.Path(__file__).resolve().parents[2]
           / "src/api/templatesApi.js").read_text()
    assert "renderTemplate" in src
    assert "saveTemplate" in src
# MS-171 Phase B — proactive memory-pressure eviction
# ---------------------------------------------------------------------------

def _read_ms171b(rel):
    import pathlib
    return (pathlib.Path(__file__).resolve().parents[2] / rel).read_text()


def test_ms171b_config_has_evict_at_pct():
    """MS-171B: guard Config + loader carry evict_at_pct."""
    src = _read_ms171b("cpp_core/src/mlx_memory_guard.h")
    assert "evict_at_pct" in src
    assert 'b.value("evict_at_pct", 0)' in src


def test_ms171b_pressure_exceeds_helper():
    """MS-171B: pressure_exceeds() gates on enabled + range + live pressure."""
    src = _read_ms171b("cpp_core/src/mlx_memory_guard.h")
    assert "inline bool pressure_exceeds(const Config& cfg)" in src
    # disabled / out-of-range / no-telemetry all return false (never evict blindly)
    assert "cfg.evict_at_pct <= 0 || cfg.evict_at_pct > 100" in src
    assert 'if (!snap.value("ok", false)) return false;' in src
    assert "return pct >= cfg.evict_at_pct;" in src


def test_ms171b_routes_evict_before_reject():
    """MS-171B: submit + stream evict idle models under pressure before rejecting."""
    src = _read_ms171b("cpp_core/src/coordinator_routes_mlx.cpp")
    assert src.count("mlx_mem_guard::pressure_exceeds(st.mlx_memory_guard_config)") == 2
    assert src.count("model_mem::ModelRegistry::instance().evict_idle(60)") == 2
    # eviction is INPROC-gated (evict_idle only exists under MATRIX_MLX_EMBED)
    assert "#ifdef MATRIX_MLX_INPROC" in src


def test_ms171b_config_template_documents_evict_at_pct():
    """MS-171B: swarm-config.template.json ships evict_at_pct (default 0)."""
    src = _read_ms171b("swarm-config.template.json")
    assert '"evict_at_pct": 0' in src


# ---------------------------------------------------------------------------
# MS-171 Phase A — unified-memory guard + pressure telemetry
# (contract tests; restored — dropped from main during concurrent rebasing)
# ---------------------------------------------------------------------------

def _read_ms171a(rel):
    import pathlib
    return (pathlib.Path(__file__).resolve().parents[2] / rel).read_text()


def test_ms171_guard_header_exists():
    """MS-171: mlx_memory_guard.h defines Config, check(), pressure section."""
    src = _read_ms171a("cpp_core/src/mlx_memory_guard.h")
    assert "namespace mlx_mem_guard" in src
    assert "struct Config" in src
    assert "min_free_gb" in src
    assert "inline json check(" in src
    assert "pressure_memory_section" in src
    assert 'snap.value("ok", false)' in src


def test_ms171_guard_wired_into_state():
    """MS-171: CoordinatorState owns the guard config."""
    src = _read_ms171a("cpp_core/src/coordinator_context.h")
    assert '#include "mlx_memory_guard.h"' in src
    assert "mlx_memory_guard_config" in src


def test_ms171_guard_loaded_at_startup():
    """MS-171: coordinator_setup reads coordinator.mlx_memory_guard."""
    src = _read_ms171a("cpp_core/src/coordinator_setup.cpp")
    assert "mlx_mem_guard::load(coord)" in src
    assert "state.mlx_memory_guard_config" in src


def test_ms171_guard_rejects_on_stream_and_submit():
    """MS-171: both /api/mlx/submit and /api/mlx/stream pre-flight the guard."""
    src = _read_ms171a("cpp_core/src/coordinator_routes_mlx.cpp")
    assert '#include "mlx_memory_guard.h"' in src
    assert src.count("mlx_mem_guard::check(st.mlx_memory_guard_config)") == 2
    assert src.count('err(res, 503, mc.value("error"') == 2


def test_ms171_pressure_surfaces_unified_memory():
    """MS-171: /api/mlx/pressure includes unified_memory when available."""
    src = _read_ms171a("cpp_core/src/coordinator_routes_mlx.cpp")
    assert "mlx_mem_guard::pressure_memory_section()" in src
    assert 'out["unified_memory"]' in src


def test_ms171_config_template_documents_guard():
    """MS-171: swarm-config.template.json ships the guard block (default off)."""
    src = _read_ms171a("swarm-config.template.json")
    assert '"mlx_memory_guard"' in src
    assert '"min_free_gb"' in src


def test_ms171b_err_accepts_std_string():
    """MS-171B: err() takes const std::string& so guard can pass json string
    values (regression: NATIVE_COORD build was never compiled, hid a const
    char* mismatch that broke the in-process build)."""
    src = _read_ms171b("cpp_core/src/coordinator_routes_mlx.cpp")
    assert "void err(httplib::Response& res, int status, const std::string& msg)" in src


# ---------------------------------------------------------------------------
# MS-83 — Response Annotation (Thumbs Up/Down + Comment)
# ---------------------------------------------------------------------------

def test_ms83_annotations_endpoint():
    """MS-83: coordinator_routes_annotations.h must implement POST/GET /api/annotations."""
    import pathlib
    src = (pathlib.Path(__file__).resolve().parents[2]
           / "cpp_core/src/coordinator_routes_annotations.h").read_text()
    assert "/api/annotations" in src
    assert "rating" in src
    assert "run_id" in src


def test_ms83_annotations_api_js():
    """MS-83: annotationsApi.js must export submitAnnotation and fetchAnnotation."""
    import pathlib
    src = (pathlib.Path(__file__).resolve().parents[2]
           / "src/api/annotationsApi.js").read_text()
    assert "submitAnnotation" in src
    assert "fetchAnnotation" in src


def test_ms83_response_rating_component():
    """MS-83: ResponseRating.js must handle rating + comment."""
    import pathlib
    src = (pathlib.Path(__file__).resolve().parents[2]
           / "src/components/ResponseRating.js").read_text()
    assert "rating" in src
    assert "comment" in src


def test_ms83_response_rating_in_conversation_turn():
    """MS-83: ConversationTurn must render ResponseRating for each entry."""
    import pathlib
    src = (pathlib.Path(__file__).resolve().parents[2]
           / "src/components/ConversationTurn.js").read_text()
    assert "ResponseRating" in src
