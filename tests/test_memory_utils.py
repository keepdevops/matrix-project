"""Tests for orchestration/memory_utils.py (cross-platform memory + backend selection)."""
from __future__ import annotations

from unittest.mock import mock_open, patch

import pytest

from orchestration import memory_utils


def test_linux_snapshot_from_meminfo():
    meminfo_text = (
        "MemTotal:        33554432 kB\n"
        "MemAvailable:    16777216 kB\n"
        "MemFree:          8388608 kB\n"
        "Buffers:           512000 kB\n"
        "Cached:           1024000 kB\n"
    )

    with patch("orchestration.memory_utils.open", mock_open(read_data=meminfo_text)):
        snap = memory_utils._linux_snapshot()

    assert snap["ok"] is True
    assert snap["total_gb"] == pytest.approx(32.0, abs=0.2)
    assert snap["free_gb"] == pytest.approx(16.0, abs=0.2)
    assert snap["used_gb"] == pytest.approx(16.0, abs=0.2)


def test_get_available_memory_gb_uses_snapshot():
    with patch.object(memory_utils, "get_host_memory_snapshot", return_value={
        "ok": True, "free_gb": 24.5,
    }):
        assert memory_utils.get_available_memory_gb() == 24.5


def test_get_available_memory_gb_fallback():
    with patch.object(memory_utils, "get_host_memory_snapshot", return_value={"ok": False}):
        assert memory_utils.get_available_memory_gb() == memory_utils._FALLBACK_AVAILABLE_GB


def test_preferred_backend_darwin():
    with patch("platform.system", return_value="Darwin"):
        assert memory_utils.preferred_backend() == "mlx"


def test_preferred_backend_linux_vllm():
    with patch("platform.system", return_value="Linux"), \
         patch.object(memory_utils.shutil, "which", return_value="/usr/bin/nvidia-smi"), \
         patch.object(memory_utils, "docker_vllm_reachable", return_value=True):
        assert memory_utils.preferred_backend() == "vllm"


def test_preferred_backend_linux_llama_fallback():
    with patch("platform.system", return_value="Linux"), \
         patch.object(memory_utils.shutil, "which", side_effect=lambda cmd: "/bin/llama-server" if cmd == "llama-server" else None), \
         patch.object(memory_utils, "docker_vllm_reachable", return_value=False):
        assert memory_utils.preferred_backend() == "llama.cpp"


def test_host_memory_snapshot_shape():
    snap = memory_utils.get_host_memory_snapshot()
    assert "ok" in snap
    assert "platform" in snap
    assert "source" in snap
    assert snap["source"] == "host"


def test_required_memory_gb_scales_with_mode():
    with patch.object(memory_utils, "mode_memory_weight_scale", return_value=1.0):
        assert memory_utils.required_memory_gb("map_reduce") == 12.0
        assert memory_utils.required_memory_gb("speculative") == 8.0


def test_check_mode_memory_ok_blocks_when_low():
    with patch.object(memory_utils, "get_available_memory_gb", return_value=6.0), \
         patch.object(memory_utils, "required_memory_gb", return_value=12.0):
        ok, err = memory_utils.check_mode_memory_ok("map_reduce")
    assert ok is False
    assert "insufficient host memory" in err


def test_check_mode_memory_ok_passes_when_sufficient():
    with patch.object(memory_utils, "get_available_memory_gb", return_value=32.0), \
         patch.object(memory_utils, "required_memory_gb", return_value=12.0):
        ok, err = memory_utils.check_mode_memory_ok("map_reduce")
    assert ok is True
    assert err is None
