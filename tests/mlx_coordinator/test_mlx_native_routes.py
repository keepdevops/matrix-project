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
# MS-132 stub route tests
# ---------------------------------------------------------------------------

def test_mlx_submit_stub_501(coord):
    """POST /api/mlx/submit → 501 (MS-133)."""
    _expect_501(coord, "POST", "/api/mlx/submit")


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
