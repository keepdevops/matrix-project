# MS-160 — Concurrency Gate: Scope for the MS-161 GO/NO-GO Re-test

**Epic:** MS-130 research track · **Points:** 2 (scope) + 3 (measure)
**Status:** ✅ MEASURED — option (B) efficiency-only. **Result: NO-GO for naive in-process concurrency.**
**Blocks:** MS-161 (~50 pts) — see Findings before opening
**Prereq read:** [MS-153](MS-153.md) (single-stream: in-process +107%), [MS-154](MS-154.md) (GO, single-stream only)

---

## ⛔ Findings (2026-06-03, Apple M3 Max, Llama-3.2-3B-4bit)

Probe: `tests/cpp/mlx_concurrency_probe.cpp` → `concurrency_benchmark()` (load
once, N threads each `PyGILState_Ensure`/`Release` around `generate()`).

| N | aggregate tok/s | result |
|---|-----------------|--------|
| 1 | **116.5** | ✅ matches MS-153 (+107% vs HTTP) — harness validated |
| 2 | — | ❌ **crash: `[METAL] Command buffer execution failed: Insufficient Memory`** |
| 4, 8 | — | not reached |

**N≥2 concurrent in-process generation crashes, reproducibly, independent of
token budget** (same crash at max_tokens=16 and 80). This is the documented
symptom of **MLX's default Metal stream not being safe for concurrent
submission from multiple threads** — `mlx_lm.generate()` shares one global
stream, and two threads submitting command buffers concurrently corrupt the
allocator / over-commit GPU memory.

The risk flagged in the harness design materialised: getting N threads through
the shared interpreter is not merely slow, it **fails outright**.

### What this means for MS-161

- The MS-153 **+107% single-stream win is real but applies only to *serialized*
  (one-at-a-time) inference.** It does not survive the concurrent multi-agent
  workload the swarm actually runs.
- The naive MS-161 design (replace HTTP fan-out with threaded in-process
  `generate()`) is **non-viable as-is** — it crashes at 2 concurrent agents.
- Achieving concurrency would require **per-thread MLX stream isolation**
  (`mx.new_stream(device)` per worker, threaded through `mlx_lm.generate()`,
  which does not expose it today). That is unproven and is itself MS-161-scale
  work — it cannot be assumed.
- The current HTTP path sidesteps this entire failure class via **process
  isolation**: each agent's `mlx_lm.server` has its own address space, Metal
  allocator, and stream; the OS arbitrates. That isolation is a feature, not
  overhead.

### Measurement caveat (RSS)

N=1 RSS here read **446 MB**, vs **2.33 GB** in MS-153 for the same model.
MLX/unified-memory allocations are not consistently reflected in mach
`resident_size`. **Treat all RSS figures in MS-153/154 as low-confidence** —
they were never the deciding metric (throughput was), but the memory-neutrality
claim in MS-154 rests on shaky measurement and should not be leaned on.

### Recommendation

**NO-GO on the naive in-process design.** Before MS-161 opens, a *prerequisite*
spike must prove per-thread MLX stream isolation gives positive concurrency
speedup without crashing. If it can't, in-process inference is only worth
pursuing for genuinely single-stream deployments — not the multi-agent swarm,
where the HTTP path's process parallelism wins by being the only thing that
runs at all.

This **supersedes the unconditional GO in MS-154**: that GO was single-stream
only and did not survive the concurrency gate.

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
