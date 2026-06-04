"""Smoke: exercise the telemetry instrumentation primitives, then verify the
expected Prometheus series exist.

(Previously this ran the registry's run_mode(); run_mode was the only caller of
these primitives and has been removed, so the test now drives instrument_mode /
instrument_generate directly — the live helpers in telemetry/metrics.py.)
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))

from backends.base import TokenChunk  # noqa: E402
from orchestration.telemetry import configure_logging, get_logger, metrics_text  # noqa: E402
from orchestration.telemetry.metrics import instrument_generate, instrument_mode  # noqa: E402


def test_instrumentation_emits_metrics():
    @instrument_generate("worker")
    async def _gen():
        yield TokenChunk(text="hello")
        yield TokenChunk(text="", done=True)

    async def run() -> None:
        async with instrument_mode("map_reduce", ["worker"]):
            async for _ in _gen():
                pass

    asyncio.run(run())

    body, ctype = metrics_text()
    text = body.decode()
    assert "agent_requests_total" in text
    assert 'mode="map_reduce"' in text
    assert 'agent_id="worker"' in text
    assert "agent_tokens_total" in text
    assert "agent_latency_seconds" in text


def test_logging_json_renders():
    configure_logging()
    log = get_logger("smoke")
    # Sanity: this must not raise; output is JSON-rendered to stderr.
    log.info("hello", request_id="r1", agent_id="a", mode="pipeline")
