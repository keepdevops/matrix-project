"""Smoke: run a mode through run_mode, then verify expected Prometheus series exist."""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))

from orchestration.modes import run_mode  # noqa: E402
from orchestration.telemetry import (  # noqa: E402
    AGENT_REQUESTS,
    AGENT_TOKENS,
    configure_logging,
    get_logger,
    metrics_text,
)

# Reuse the FakeBackend + ctx builder from the modes test.
sys.path.insert(0, str(REPO / "tests" / "modes"))
from test_registry import _make_ctx  # noqa: E402


def test_run_mode_emits_metrics():
    ctx = _make_ctx(["a", "b"])

    async def consume() -> int:
        n = 0
        async for _ in run_mode("pipeline", ctx, "q"):
            n += 1
        return n

    assert asyncio.run(consume()) > 0

    body, ctype = metrics_text()
    text = body.decode()
    assert "agent_requests_total" in text
    assert 'mode="pipeline"' in text
    assert 'agent_id="a"' in text
    assert "agent_tokens_total" in text
    assert "agent_latency_seconds" in text


def test_logging_json_renders():
    configure_logging()
    log = get_logger("smoke")
    # Sanity: this must not raise; output is JSON-rendered to stderr.
    log.info("hello", request_id="r1", agent_id="a", mode="pipeline")
