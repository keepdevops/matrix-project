"""Coordinator HTTP backend wrapper — regression guard for PythonMlxBackend path."""
from __future__ import annotations

import pytest

from backends.base import GenerateRequest, InferenceBackend
from orchestration.mlx_coordinator.backend import MlxBackend


def test_mlx_backend_is_inference_backend():
    assert issubclass(MlxBackend, InferenceBackend)


def test_mlx_backend_id():
    b = MlxBackend(port=8081, agent_id="test")
    assert b.backend_id == "mlx"


@pytest.mark.asyncio
async def test_mlx_backend_build_messages_merges_system():
    b = MlxBackend(port=8081, agent_id="test", system_prompt="SYS")
    msgs = b._build_messages("hello")
    assert len(msgs) == 1
    assert msgs[0]["role"] == "user"
    assert "SYS" in msgs[0]["content"]
    assert "hello" in msgs[0]["content"]
