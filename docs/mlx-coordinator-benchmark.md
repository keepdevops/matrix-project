# MLX Coordinator Benchmark — C++ vs Python

**Epic:** MS-130 · **Issue:** MS-150 (post-ship)
**Date:** 2026-06-03
**Reproduce:** `python3 scripts/benchmark_mlx.py --n 200`

This report compares the **coordinator overhead** of the native C++ `/api/mlx/*`
routes (MS-130, port 3002) against the decommissioned Python aiohttp coordinator
(port 3003). It measures only the coordinator's request-parse → dispatch →
response path; `mlx_lm.server` inference time is excluded from both sides so the
numbers reflect the framework cost, not the model.

---

## Test environment

| | |
|---|---|
| Machine | Mac15,11 — Apple M3 Max |
| OS | macOS 26.5 |
| Compiler | Apple clang 21.0.0, `-std=c++17 -O2` |
| Coordinator | C++ httplib, `MATRIX_MLX_NATIVE_COORD=1`, ~3.0 MB binary |
| Config | `swarm-config.json` (1 MLX agent: mlx-scout :8083) |
| Samples | 200 per metric (TTFB: 20; concurrent: 20 iterations × 10 parallel) |

**Python baseline** is the aiohttp `orchestration/mlx_coordinator/service.py`
measured with mock backends before MS-130. It is included as documented
estimates in `scripts/benchmark_mlx.py` (`PYTHON_BASELINE`), not re-measured here
since the service is decommissioned (MS-144).

---

## Results

| Metric | C++ p50 | C++ p95 | Python p50 | Speedup (p50) |
|--------|--------:|--------:|-----------:|--------------:|
| `GET /api/mlx/health` | 0.8 ms | 1.2 ms | 12.0 ms | **15×** |
| `GET /api/mlx/pressure` | 0.4 ms | 0.4 ms | 8.0 ms | **22×** |
| `POST /api/mlx/submit` (400 fast-path) | 0.7 ms | 0.9 ms | 14.0 ms | **19×** |
| `POST /api/mlx/stream` TTFB | 0.7 ms | 1.0 ms | 80.0 ms | **108×** |
| 10× concurrent submit (wall) | 5.0 ms | 5.7 ms | 55.0 ms | **11×** |

All C++ coordinator overheads are **sub-millisecond at p50** and well within the
**<50 ms p95 hot-path target** from the parity doc §1.

---

## Analysis

### Why the C++ path is faster

1. **No interpreter / event-loop dispatch.** The Python path pays aiohttp
   middleware traversal, coroutine scheduling, and per-request object
   allocation. httplib dispatches directly to a registered lambda.

2. **Stream TTFB is the standout (108×).** The old Python `handle_submit` /
   blocking path waited for the full mock response before the first byte; even
   the SSE path incurred event-loop hops per chunk. The C++ `set_chunked_content_provider`
   writes the first SSE frame (`agent_start`) synchronously as the provider
   opens — the connection-pool reuse from MS-148 keeps the socket warm.

3. **Pressure is cheapest (0.4 ms).** It reads `mlx_inflight` atomics and a
   `MlxSessionStore` snapshot under one mutex — no I/O, no allocation beyond the
   JSON dump.

### What this measures and what it doesn't

- **Measured:** request parse, route dispatch, JSON build, response write, and
  (for health) the `/v1/models` probe round-trip to a local mlx_lm.server port
  via the pooled connection.
- **Not measured:** model inference latency. With a real model loaded,
  end-to-end submit latency is dominated by `mlx_lm.server` decode time (seconds),
  so the coordinator's ~1 ms is noise at that scale. The win shows up under
  **concurrency** and on **health/pressure polling** the UI does every few seconds.

### Concurrency

10 parallel bad-request submits complete in 5.0 ms wall time vs 55 ms on Python.
The per-port `std::mutex` (MS-147) serialises only same-port inference calls;
request parsing and the 400 fast-path run fully in parallel across httplib's
thread pool, so the coordinator does not become a throughput bottleneck for the
UI's frequent health/pressure polling.

---

## Conclusion

The native C++ MLX coordinator adds **negligible overhead** (sub-millisecond p50,
≤1.2 ms p95) to every `/api/mlx/*` route, a **10–108× reduction** over the Python
baseline. Combined with removing the separate `:3003` process (MS-144), MS-130
both simplifies the deployment and removes the coordinator as a latency factor.

For the user-visible win: the Brewlatte UI polls `/api/mlx/health` and
`/api/mlx/pressure` on a timer — those now cost ~1 ms instead of ~10–28 ms,
keeping the KV-pressure gauge and monitor popout responsive even under load.

**Remaining latency work** (true per-token MLX streaming, VRAM pre-flight) is
tracked in epic **MS-170**.
