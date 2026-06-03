# MS-160 — Concurrency Gate: Scope for the MS-161 GO/NO-GO Re-test

**Epic:** MS-130 research track · **Points:** 2 (scope) + 3 (measure)
**Status:** ✅ MEASURED + CORRECTED — option (B). **Result: in-process concurrency works but gives no throughput benefit on a single GPU. See Findings + Options.**
**Blocks:** MS-161 (~50 pts) — see Findings before opening
**Prereq read:** [MS-153](MS-153.md) (single-stream: in-process +107%), [MS-154](MS-154.md) (GO, single-stream only)

---

## Findings (2026-06-03, Apple M3 Max, Llama-3.2-3B-4bit) — CORRECTED

> An earlier revision of this doc concluded "NO-GO — crashes at N=2." That was
> **wrong** and is corrected here. The crash proved **intermittent** (one OOM,
> not reproducible): the pure-Python proxy never crashed, and a C++ re-run
> completed the full N=1/2/4/8 sweep. The real finding is about throughput, not
> stability.

### C++ embedded probe (`mlx_concurrency_probe`, full sweep)

| N | aggregate tok/s | speedup | per-stream tok/s | RSS |
|---|-----------------|---------|------------------|-----|
| 1 | 111.5 | 1.0× | 111 | 2329 MB |
| 2 |  81.7 | 0.7× |  41 | 2450 MB |
| 4 | 106.3 | 1.0× |  27 | 2508 MB |
| 8 | 108.3 | 1.0× |  14 | 2584 MB |

### Pure-Python proxy (same GIL; validates shared vs per-thread streams)

| config | N=2 agg | N=4 agg | speedup(4) |
|--------|---------|---------|-----------|
| shared default stream | 127 | 139 | 1.23× |
| per-thread `mx.stream` | 127 | 135 | 1.20× |

### What the data actually shows

1. **No throughput benefit from concurrency.** Aggregate plateaus at ~1.0–1.2×
   of single-stream regardless of N. A single Apple-Silicon GPU saturates on
   decode (memory-bandwidth bound) — concurrent streams time-share it.
2. **Per-stream throughput collapses with N:** 111 → 41 → 27 → 14 tok/s. Four
   concurrent agents don't run faster as a group; each runs ~4× slower. This is
   a **hardware reality of one GPU**, and it applies to the HTTP path identically.
3. **Per-thread streams don't help aggregate** but do even out per-stream
   latency (no starvation) — 64/64 vs the shared stream's 68/59 at N=2.
4. **The +107% single-stream win does NOT compound across agents.** It is a
   per-request latency + memory advantage, not a concurrent-throughput multiplier.
5. **One intermittent OOM** was observed in the C++ path under memory pressure —
   a fragility signal the process-isolated HTTP path does not have.

### RSS correction

C++ probe RSS reads ~2.3–2.6 GB, growing modestly with N (shared weights + per-
stream KV caches) — consistent with MS-153's 2.33 GB. The earlier 446 MB reading
was the anomaly. Memory is **one model copy** regardless of N, vs HTTP's N copies.

## Options (no clean GO or NO-GO — it's a fit-to-workload call)

| # | Path | When it wins | Cost / risk |
|---|------|--------------|-------------|
| **1** | **MS-161 scoped to sequential modes only** (pipeline, cascade-synth, single-agent chat) | Agents run one-at-a-time → full +107% latency win | Must NOT claim concurrent throughput gains; embedding maintenance burden |
| **2** | **Hybrid:** in-process for the foreground/latency-critical agent, HTTP for concurrent fan-out | Best of both — latency win where it matters, process isolation for flat-mode | Most complex; two inference paths to maintain |
| **3** | **Keep HTTP, drop MS-161** | Concurrency gives no throughput benefit anyway; HTTP is robust + process-isolated | Forgoes the +107% single-stream latency win |
| **4** | **De-risk first:** root-cause the intermittent OOM before any commit | The one crash is a real production-stability question under load | 1–2 day spike before the MS-161 decision |

**Recommendation:** Option 1 or 2. The +107% is real and worth capturing for the
**sequential** paths (which pipeline/cascade modes use heavily). Do not pursue
in-process for concurrent flat-mode throughput — no architecture beats the single
GPU there, and HTTP's isolation is safer under load. Resolve the OOM (Option 4)
as a gate inside whichever path is chosen.

---

## Why this exists

MS-153 measured **single-stream** throughput: one prompt, one model, sequential.
In-process won by +107%. But the Matrix swarm's real workload is **concurrent
multi-agent** — flat/cascade modes fan out to N agents at once.

The current HTTP path gets that parallelism **for free** from the OS: each agent
runs in its own `mlx_lm.server` process on its own port, and the coordinator
fans out with `std::async` holding only a per-port mutex
(`coordinator_routes_mlx.cpp:100`). Agents on different ports run truly
concurrently; only the shared Metal GPU arbitrates.

The MS-161 in-process design replaces those N processes with **one embedded
CPython interpreter**. All N agents' `generate()` calls compete for **one GIL**.

> **The question MS-160 must answer:** Does GIL serialization erase the +107%
> single-stream win under the swarm's real concurrent load — or does MLX release
> the GIL enough during Metal compute that in-process still wins (or breaks even)?

If the GIL serializes everything, the +107% headline is a mirage for the actual
workload and MS-161's 50 pts buy a *regression* on multi-agent runs.

## Hypotheses

- **H0 (GIL kills it):** in-process aggregate throughput at N=4 ≈ single-stream
  (everything serializes through the GIL) → **NO-GO**, MS-161 needs a different
  architecture (sub-interpreters / per-agent process pool).
- **H1 (MLX releases GIL):** `mlx_lm.generate()` releases the GIL during Metal
  kernel submission, so aggregate scales with the GPU, not the GIL → in-process
  ≥ HTTP aggregate → **GO confirmed**.
- Reality is likely between: Python-level sampling/detokenization holds the GIL,
  Metal compute releases it. The split is empirical — that's what we measure.

## Metrics

| Metric | Definition | Why |
|--------|------------|-----|
| **Aggregate tok/s** | Σ tokens across all N streams ÷ wall time | Headline — total swarm throughput |
| **Scaling efficiency** | aggregate(N) ÷ (N × single-stream) | 100% = perfect parallelism, ~1/N = full serialization |
| **Per-stream p50/p95** | latency distribution across the N streams | Detects starvation (one agent blocked behind the GIL) |
| **GIL-hold ratio** | (in-process aggregate) ÷ (HTTP aggregate) at same N | The direct head-to-head |

Sweep **N = 1, 2, 4, 8** (swarm rosters are typically 4–8 agents).

## Decision criteria (feeds a revised MS-154)

- **GO-confirm:** in-process aggregate at N=4 is **≥ 90%** of HTTP aggregate at
  N=4. GIL overhead is less than the process/IPC overhead it removes.
- **CONDITIONAL:** in-process is 60–90% of HTTP — win on single-stream, modest
  loss on concurrency. MS-161 proceeds only with a GIL-mitigation sub-task
  (sub-interpreters per agent) added to its scope.
- **NO-GO:** in-process < 60% of HTTP at N=4. The single-stream win doesn't
  survive the real workload; close MS-161 or redesign before opening.

## Harness design

New probe `tests/cpp/mlx_concurrency_probe.cpp` (reuses `matrix_mlx_generate_lib`):

### In-process arm
- Init interpreter once. Load the model once (or M models for the multi-model case).
- Spawn N `std::thread`s; **each must `PyGILState_Ensure()` / `PyGILState_Release()`**
  around its `generate()` call. **Risk flag:** if getting N threads safely through
  the embedded interpreter is itself hard/unstable, that is a primary MS-161
  finding — surface it, don't paper over it.
- Record per-thread start/end + token counts; compute aggregate + per-stream p50/p95.

### HTTP arm — **open decision (needs input)**
The honest head-to-head needs N real `mlx_lm.server` processes. Two options:

- **(A) Full head-to-head:** stand up 4 `mlx_lm.server` instances on 4 ports with
  4 (or 1 shared) models; drive N concurrent `/v1/chat/completions`. Most faithful,
  but heavy setup and GPU memory for 4 resident models.
- **(B) Efficiency-only:** measure the **in-process scaling efficiency** alone
  (aggregate(N) ÷ N×single-stream) and compare against the HTTP path's *known*
  behaviour — separate processes get near-linear cross-port scaling until the GPU
  saturates. Cheaper; relies on the architectural argument rather than a live
  HTTP number.

**Recommendation: (B) first** (1 day, answers H0 vs H1 directly via the efficiency
curve), escalate to (A) only if (B) lands in the CONDITIONAL band where the exact
HTTP delta matters.

## What this is NOT

- Not a rewrite of MS-153 — single-stream numbers stand.
- Not MS-161 itself — no production code changes; probe lives behind the
  `mlx_embed` CMake target like the other spikes.

## Open decision for sign-off

1. **HTTP-baseline approach: (A) full head-to-head or (B) efficiency-only first?**
2. Concurrency sweep ceiling — N=8 enough, or test higher (16) for large rosters?
