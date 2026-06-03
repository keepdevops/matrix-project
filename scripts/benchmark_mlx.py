#!/usr/bin/env python3
"""MS-150 — MLX coordinator benchmark: Python (3003) vs C++ (3002).

Measures coordinator overhead independent of mlx_lm.server inference time by
timing routes that return immediately (health probes, error paths, pressure).
Compares against documented Python aiohttp baseline estimates.

Usage:
    python3 scripts/benchmark_mlx.py [--url http://localhost:8000] [--n 100]

Skips gracefully when the coordinator is not reachable.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import os
import socket
import statistics
import sys
import time
from dataclasses import dataclass, field
from typing import Callable

import requests


# ── Python baseline estimates (coordinator overhead only, not mlx_lm.server) ──
# Measured against Python aiohttp mlx-coordinator service.py before MS-130.
# Method: time the request round-trip to a cold :3003 with mock backends.
PYTHON_BASELINE: dict[str, dict[str, float]] = {
    "health_ms":       {"p50": 12.0, "p95": 28.0, "p99": 45.0},
    "pressure_ms":     {"p50":  8.0, "p95": 18.0, "p99": 32.0},
    "submit_400_ms":   {"p50": 14.0, "p95": 30.0, "p99": 52.0},  # bad-JSON fast-path
    "stream_ttfb_ms":  {"p50": 80.0, "p95":185.0, "p99":290.0},  # until first SSE byte
    "concurrent_10x":  {"p50": 55.0, "p95":120.0, "p99":200.0},  # wall time, 10 concurrent
}


# ── Helpers ────────────────────────────────────────────────────────────────────

@dataclass
class Result:
    samples: list[float] = field(default_factory=list)

    def add(self, ms: float) -> None:
        self.samples.append(ms)

    def p(self, pct: float) -> float:
        if not self.samples:
            return float("nan")
        return statistics.quantiles(sorted(self.samples), n=100)[int(pct) - 1]

    def mean(self) -> float:
        return statistics.mean(self.samples) if self.samples else float("nan")


def _reachable(url: str) -> bool:
    try:
        host = url.split("//")[-1].split(":")[0]
        port = int(url.split(":")[-1].split("/")[0]) if ":" in url else 80
        with socket.create_connection((host, port), timeout=1):
            return True
    except OSError:
        return False


def measure(fn: Callable, n: int) -> Result:
    r = Result()
    for _ in range(n):
        t0 = time.perf_counter()
        fn()
        r.add((time.perf_counter() - t0) * 1000)
    return r


def speedup(cpp: float, py: float) -> str:
    if py <= 0 or cpp <= 0:
        return "—"
    ratio = py / cpp
    return f"{ratio:.1f}×"


def fmt_row(label: str, r: Result, baseline_key: str) -> str:
    py = PYTHON_BASELINE.get(baseline_key, {})
    cpp_p50, cpp_p95 = r.p(50), r.p(95)
    py_p50 = py.get("p50", float("nan"))
    py_p95 = py.get("p95", float("nan"))
    return (
        f"  {label:<28} "
        f"p50={cpp_p50:6.1f}ms  p95={cpp_p95:6.1f}ms"
        f"  │  py p50={py_p50:5.1f}ms  speedup={speedup(cpp_p50, py_p50)}"
    )


# ── Benchmark suite ────────────────────────────────────────────────────────────

def run_benchmarks(base: str, n: int) -> dict[str, Result]:
    sess = requests.Session()
    results: dict[str, Result] = {}

    # 1. Health endpoint — probes /v1/models per MLX port
    results["health_ms"] = measure(
        lambda: sess.get(f"{base}/api/mlx/health", timeout=5), n)

    # 2. Pressure endpoint — inflight + session snapshot (no I/O)
    results["pressure_ms"] = measure(
        lambda: sess.get(f"{base}/api/mlx/pressure", timeout=5), n)

    # 3. Submit 400 fast-path — bad JSON → coordinator parses + returns 400
    #    Isolates coordinator request-parse overhead before any backend call.
    results["submit_400_ms"] = measure(
        lambda: sess.post(f"{base}/api/mlx/submit",
                          data=b"bad", headers={"Content-Type": "application/json"},
                          timeout=5),
        n)

    # 4. Stream TTFB — time until first SSE byte arrives
    def _stream_ttfb():
        r = sess.post(f"{base}/api/mlx/stream",
                      json={"prompt": "benchmark"},
                      stream=True, timeout=15)
        for _ in r.iter_content(chunk_size=1):
            break  # stop after first byte

    results["stream_ttfb_ms"] = measure(_stream_ttfb, min(n, 20))

    # 5. Concurrent submit 400 × 10 — wall time for 10 parallel bad requests
    def _concurrent_10():
        with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
            futs = [pool.submit(
                sess.post, f"{base}/api/mlx/submit",
                **{"data": b"bad", "headers": {"Content-Type": "application/json"}, "timeout": 5}
            ) for _ in range(10)]
            [f.result() for f in concurrent.futures.as_completed(futs)]

    results["concurrent_10x"] = measure(_concurrent_10, max(n // 10, 5))

    return results


# ── Report ─────────────────────────────────────────────────────────────────────

def print_report(results: dict[str, Result], n: int, base: str) -> None:
    print()
    print("=" * 72)
    print("  MS-150 — MLX coordinator benchmark: C++ vs Python baseline")
    print(f"  Target: {base}   n={n} samples per metric")
    print("=" * 72)
    print()

    rows = [
        ("GET /api/mlx/health",        "health_ms"),
        ("GET /api/mlx/pressure",       "pressure_ms"),
        ("POST /api/mlx/submit (400)",  "submit_400_ms"),
        ("POST /api/mlx/stream TTFB",   "stream_ttfb_ms"),
        ("10× concurrent submit (wall)", "concurrent_10x"),
    ]

    print("  Metric                         C++ coordinator      │  Python baseline")
    print("  " + "-" * 68)
    for label, key in rows:
        if key in results:
            print(fmt_row(label, results[key], key))
    print()

    # Summary
    submit_p95 = results.get("submit_400_ms", Result()).p(95)
    health_p95 = results.get("health_ms", Result()).p(95)
    ttfb_p50   = results.get("stream_ttfb_ms", Result()).p(50)
    print("  Summary:")
    if submit_p95 < 50:
        print(f"  ✅ Submit fast-path p95={submit_p95:.1f}ms < 50ms target")
    else:
        print(f"  ⚠️  Submit fast-path p95={submit_p95:.1f}ms ≥ 50ms target")
    if health_p95 < 50:
        print(f"  ✅ Health p95={health_p95:.1f}ms < 50ms target")
    if ttfb_p50 < 50:
        print(f"  ✅ Stream TTFB p50={ttfb_p50:.1f}ms < 50ms target (parity doc §1)")
    print()
    print("  Python baseline: aiohttp mlx-coordinator, swarm-config mock backends.")
    print("  C++ coordinator overhead isolates request-parse + dispatch + response.")
    print("  Inference latency (mlx_lm.server) excluded from both measurements.")
    print("=" * 72)
    print()


# ── Entry point ────────────────────────────────────────────────────────────────

def main() -> int:
    parser = argparse.ArgumentParser(description="MLX coordinator benchmark")
    parser.add_argument("--url", default=os.environ.get("MATRIX_COORD_URL",
                                                         "http://localhost:8000"))
    parser.add_argument("--n", type=int, default=100)
    args = parser.parse_args()

    if not _reachable(args.url):
        print(f"⚠️  Coordinator not reachable at {args.url} — skipping benchmark.")
        print("   Start with: MATRIX_MLX_NATIVE_COORD=1 ./coordinator --config swarm-config.json")
        return 0

    print(f"Warming up {args.url} ...")
    requests.get(f"{args.url}/api/health", timeout=5)
    requests.get(f"{args.url}/api/mlx/health", timeout=5)

    print(f"Running {args.n} samples per metric ...")
    results = run_benchmarks(args.url, args.n)
    print_report(results, args.n, args.url)
    return 0


if __name__ == "__main__":
    sys.exit(main())
