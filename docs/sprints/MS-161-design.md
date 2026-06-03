# MS-161 — In-Process MLX Inference: Design

**Epic:** MS-161 · **Status:** DESIGN on branch `ms-161-design`
**MS-160:** Measured — sequential in-process wins; concurrent GPU submission NO-GO ([MS-160-concurrency-scope.md](./MS-160-concurrency-scope.md))
**Status:** ✅ Phases A, B, D complete (2026-06-03). Phase C (pipeline/cascade inproc via stream path) remains. In-process MLX submit is opt-in behind MATRIX_MLX_INPROC + per-agent `dispatch:inproc`.
**Feeds MS-68:** Task 1 registry generalization ([MS-68-mlx-model-memory.md](./MS-68-mlx-model-memory.md))
**Grounded in:** [MS-153](MS-153.md) (+107% single-stream), [MS-160](MS-160-concurrency-scope.md) (concurrency is GPU-bound; intermittent OOM)

## Context

MLX agents currently run as separate `mlx_lm.server` processes; the coordinator
reaches them over HTTP via `call_agent()` (`cpp_core/src/agent_client.cpp:35`)
and `stream_agent()` (`cpp_core/src/agent_stream.cpp`). MS-153 showed that doing
the same generation **in-process** (CPython + libmlx embedded in the coordinator)
is **+107% faster** single-stream — it removes the HTTP round-trip and
`mlx_lm.server`'s per-token overhead.

MS-160 then measured the catch: on a single GPU, **concurrency gives no
throughput benefit** (aggregate plateaus ~1.0–1.2× regardless of N; per-stream
collapses 111→14 tok/s at N=8), and concurrent command-buffer submission
triggered an **intermittent Metal OOM**. So the in-process win is a
**per-request latency + memory** advantage for *sequential* inference — not a
concurrent-throughput multiplier.

**This design captures that win without inheriting the concurrency risk:**
serialize all in-process GPU work through one lane (free, since there's no
concurrency to lose) and keep flat-mode fan-out on HTTP (whose process isolation
*is* its parallelism). Memory favors in-process structurally — weights are
resident once (~2.3 GB), each stream adds only ~20–30 MB.

## Non-goals

- Concurrent in-process throughput scaling (MS-160: not achievable on one GPU).
- Replacing the HTTP path for flat-mode fan-out (keep it — isolation is a feature).
- Linux/CUDA (Darwin arm64 + Metal only, like the rest of the embed work).

## Architecture

### 1. `MlxModelRegistry` — resident models, one copy each

```
class MlxModelRegistry {
  // agent_name → ResidentModel{ PyObject* model, PyObject* tok, last_used }
  ResidentModel& get_or_load(const Agent& agent);   // load-on-first-use
  int  evict_idle(int max_idle_secs);               // LRU, mirrors MlxSessionStore
  json snapshot() const;                            // for /api/mlx/pressure
};
MlxModelRegistry& mlx_models();   // process singleton, like mlx_sessions()
```

- Reuse the eviction/LRU shape already proven in `MlxSessionStore`
  (`cpp_core/src/mlx_session_store.{h,cpp}`).
- One resident copy per distinct model path — shared across agents that use it.
- Loads hold the GIL (model load is itself a Python call); guarded by the lane below.

### 2. `MlxGpuLane` — single serialized submission lane

```
class MlxGpuLane {
  // All in-process generate()/stream calls pass through here.
  std::string run(const Agent&, const std::string& prompt, OnChunk, session_id);
 private:
  std::mutex lane_mu_;   // one generate() in flight per process
};
```

- One `std::mutex` gates every in-process MLX dispatch. Serialization is **free**
  (MS-160: no concurrent throughput) and **eliminates the OOM class** (the
  intermittent OOM was concurrent submission to a near-full Metal heap).
- Inside the lane: `PyGILState_Ensure` → `mlx_lm.generate()` (reuse the proven
  `generate_via_python` / `stream_mlx` machinery from `mlx_embed_generate.cpp`)
  → `PyGILState_Release`.
- Token streaming reuses the existing `agent_stream::OnChunk` callback contract,
  so the SSE path (`coordinator_routes_mlx.cpp` stream handler) is unchanged
  above the dispatch line.

### 3. Dispatch routing — where in-process is chosen

The dispatch chokepoints are already `call_agent()` and `stream_agent()`. Add a
routing predicate keyed on **agent config**, not call site:

- `swarm-config.json`: MLX agents gain `"dispatch": "inproc" | "http"`
  (default `"http"` — opt-in, zero behavior change when unset).
- `call_agent`/`stream_agent`: if `agent.engine == "mlx"` and
  `agent.dispatch == "inproc"` → `MlxGpuLane::run(...)`; else existing HTTP path.
- **Per-agent routing avoids the double-model-copy problem**: a model is resident
  either in the coordinator (inproc) or in `mlx_lm.server` (http), never both.
  Operators tag latency-critical / sequential agents `inproc`; flat-mode workers
  stay `http`.

This is the clean resolution of the Option-1-vs-2 question from MS-160: it's
config-driven hybrid, with the safe default being today's behavior.

## Build / deploy cost (the real price — call it out)

Enabling `inproc` links **libpython3.12 + libmlx into the production
`coordinator` binary** (today it links neither — confirmed in
`scripts/build_cpp_binaries.sh`). This is the significant cost:

- Coordinator gains a runtime dependency on the conda `mlx-env` (libpython, libmlx).
- Darwin arm64 only; the Linux/llama/vLLM coordinator build is unaffected.
- Gated behind a build flag `MATRIX_MLX_INPROC` (off by default) so the standard
  coordinator build is byte-for-byte unchanged. The CMake embed machinery
  (`cpp_core/CMakeLists.txt`) already resolves libpython+libmlx and patches rpath
  — reuse it.

## Phasing (Phase A is the gate)

| Phase | Work | Exit criterion |
|-------|------|----------------|
| **A — OOM gate** | ✅ **PASS (2026-06-03).** `mlx_bench_probe <model> 32 300` — 300 sequential generates, model resident. | **Zero OOM**; peak RSS dead flat (2503 MB iter 0 = final, +0.0%); deterministic. The MS-160 OOM was a *concurrent*-submission artifact — serializing via `MlxGpuLane` eliminates it, confirming the design thesis. **Gate passed → Phase B unblocked, pending the build-dependency decision.** |
| **B — single-agent submit** | ✅ **DONE (2026-06-03).** `MlxModelRegistry` + serialized lane (`mlx_model_registry.{h,cpp}`); `agent.dispatch="inproc"` routed in `/api/mlx/submit` behind `MATRIX_MLX_INPROC` (implies `MATRIX_MLX_EMBED`, links libpython into the coordinator). | **Verified e2e**: inproc agent, no mlx_lm.server — call 1 (load+gen) 5.9s, call 2 (resident) 0.5s, coherent output. Invariants: flag-off coordinator has 0 inproc symbols; HTTP contract suite 37/37. |
| **C — sequential modes** | Extend routing to pipeline + cascade-synthesizer (sequential stages); stream path through the lane. | pipeline/cascade on `inproc` agents stream correctly; flat-mode still HTTP. |
| **D — ship gate** | ✅ **DONE (2026-06-03), with caveats.** `/api/mlx/pressure` surfaces `resident_models` + `resident_count` (under flag); operator doc `docs/model-management.md`. | Soak: 150/150 submits OK, 0 fail, model resident throughout, RSS flat (no leak), no OOM — *representative (~150 req / 73 s), not a literal 1 h*. Tests: `mlx_coordinator` **149 passed / 58 skipped / 0 failed**. **ASan deferred** — embedded CPython's allocator yields false positives; needs a Python-suppressions file (follow-up). |

Estimated ~10–15 pts (B+C+D), **not** the ~50 the original MS-161 placeholder
carried — concurrency scaling (the bulk of that estimate) is off the table.

## Verification

- **Phase A:** `bash scripts/build_mlx_embed.sh && ./build/mlx_embed/mlx_bench_probe <model> 80 500`
  — watch RSS column for growth, confirm no OOM.
- **Phase B+:** `MATRIX_MLX_INPROC=1 bash scripts/build_cpp_binaries.sh`, run coordinator,
  tag a test agent `"dispatch":"inproc"`, drive `/api/mlx/submit`, compare output +
  latency vs the same agent on `http`. `pytest tests/mlx_coordinator/test_mlx_native_routes.py`.
- **Regression guard:** default build (no flag) must produce an identical
  coordinator binary and pass the full suite — in-process is strictly opt-in.

## Open questions for whoever picks this up

1. Is the +107% single-stream latency win worth a libpython/libmlx dependency in
   the production coordinator? (If most MLX use is flat-mode, maybe not.)
2. Phase A OOM root-cause: is it a Metal heap-pressure artifact (serialization
   fixes it, as designed) or a deeper MLX/thread issue? Phase A answers this
   before any production code is written.
