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


def test_mlx_stream_stub_501(coord):
    """POST /api/mlx/stream → 501 (MS-136)."""
    _expect_501(coord, "POST", "/api/mlx/stream")


def test_mlx_health_stub_501(coord):
    """GET /api/mlx/health → 501 (MS-134)."""
    _expect_501(coord, "GET", "/api/mlx/health")


def test_mlx_pressure_stub_501(coord):
    """GET /api/mlx/pressure → 501 (MS-134)."""
    _expect_501(coord, "GET", "/api/mlx/pressure")


def test_mlx_agents_stub_501(coord):
    """GET /api/mlx/agents → 501 (MS-139)."""
    _expect_501(coord, "GET", "/api/mlx/agents")


def test_mlx_modes_stub_501(coord):
    """GET /api/mlx/modes → 501 (MS-139)."""
    _expect_501(coord, "GET", "/api/mlx/modes")


def test_mlx_modes_active_stub_501(coord):
    """POST /api/mlx/modes/active → 501 (MS-139)."""
    _expect_501(coord, "POST", "/api/mlx/modes/active")


def test_mlx_session_clear_stub_501(coord):
    """POST /api/mlx/session/clear → 501 (MS-140)."""
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
