# MLX Inference Architecture — C++ Core vs Python Policy

**Branch:** `ms-161-design` · **Updated:** 2026-06-03

## Principle

| Layer | Owns | Why |
|-------|------|-----|
| **C++ coordinator** | Throughput mechanics: load-once weights, GPU serialization, paged KV, optional Flash | Minimize latency; one copy in VRAM; Metal at the metal |
| **Python orchestration** | Policy: RAG routing, contracts, eviction thresholds, trajectory export | Rapid iteration; no rebuild for rule changes |
| **Boundary** | JSON telemetry over existing HTTP routes (`/api/mlx/pressure`, trajectory hooks) | Orchestration stays agile without blind dispatch |

No pybind in Phase 1. Policy reads **telemetry**, not tensors.

---

## Phase 1 — Now (2026 Q2)

### MS-161 — Sequential in-process win (10–15 pts)

**Design:** [docs/sprints/MS-161-design.md](../sprints/MS-161-design.md)

Grounded in MS-160: **one GPU → no concurrent in-process throughput**; **+107% single-stream**; intermittent OOM under concurrent submission → **one `MlxGpuLane` mutex**.

```
Agent config: "dispatch": "inproc" | "http"  (default http)

call_agent / stream_agent
  └─ mlx + inproc  → MlxGpuLane → MlxModelRegistry → mlx_lm.generate (GIL inside lane)
  └─ mlx + http    → existing httplib → mlx_lm.server (unchanged)
  └─ flat fan-out  → stays http (process isolation = parallelism)
```

**Phases:** A OOM soak → B submit → C pipeline/cascade stream → D ship gate.

### MS-68 — Memory foundation (34 pts, after MS-161-B)

**Spec:** [docs/sprints/MS-68-mlx-model-memory.md](../sprints/MS-68-mlx-model-memory.md)

MS-68 **extends** MS-161 primitives; does not replace them:

| MS-161 (now) | MS-68 (next) |
|--------------|--------------|
| `MlxModelRegistry` per agent/model path | `ModelRegistry` keyed by `(model_id, quant)` + `ref_count` |
| `MlxGpuLane` (1 mutex) | Same lane + per-port rules for http path |
| `dispatch: inproc\|http` | Add `auto` + unified snapshot for UI |
| — | `PagedKVCache` (prefix hash, importance eviction) |
| — | `FlashAttentionWrapper` (flag, fallback) |
| — | Trajectory + MetricsStrip fields |

**MS-68 Task 1 ≈ generalize MS-161 registry** — implement 161 first on `ms-161-design`, then widen to multi-agent `(model_id, quant)` sharing.

---

## Phase 2 — Native bindings (2026 H2)

**Goal:** Python policy modules call C++ registry/KV **without** HTTP, still not holding GIL during Metal work.

- pybind11 surface: `acquire_model`, `release_model`, `kv_hit_rate`, `evict(threshold)`, `registry_snapshot()`
- Coordinator remains one process; Python sidecar or embedded policy worker
- **Still** serialize GPU through `MlxGpuLane` — bindings do not re-enable MS-160 OOM class

**Non-goals:** Exposing raw `mx.array` to Python; training loops in policy path.

---

## Phase 3 — Single static binary (2027)

- Optional fully-static coordinator + embedded policy DSL or WASM rules engine
- Only if Phase 1–2 prove policy churn is the bottleneck
- Linux MLX remains out of scope unless MS-170 CUDA path matures

---

## Thread-safety model (MS-68 / MS-161)

MS-160 killed **concurrent in-process GPU submission**. Lock order:

```
1. MlxGpuLane::lane_mu_     — at most one generate/stream in-process globally
2. ModelRegistry::registry_mu — acquire/release/refcount; no load under http path
3. mlx_coordinator::port_mutex(port) — per mlx_lm.server port (http only)
4. GIL — only inside lane, bracketing Python C API calls
```

**Rule:** Never hold `registry_mu` while waiting on `lane_mu` (deadlock with reverse order in pressure snapshot).

**Actor-style alternative (MS-68 R1):** single worker thread owns all MLX Python calls; API threads enqueue `GenerateJob` — consider if lane mutex proves insufficient under mixed http+inproc load.

---

## Telemetry contract (Python reads this)

Extend `GET /api/mlx/pressure` and trajectory export:

```json
{
  "registry": {
    "resident_models": 2,
    "total_bytes": 4831838208,
    "models": [{"id": "Llama-3.2-3B-4bit", "refs": 4, "dispatch_mix": {"inproc": 2, "http": 2}}]
  },
  "paged_kv": {"hit_rate": 0.72, "pages": 128, "evicted": 3},
  "flash": {"enabled": true, "fallback_count": 0},
  "lane": {"in_flight": false, "queue_depth": 0}
}
```

Python orchestration uses this for contracts / eviction — **no tensor access**.

---

## Recommended execution order

1. **Merge `ms-161-design` doc** — already on branch; run **Phase A** OOM soak.
2. **Implement Phase B** — `MlxModelRegistry` + `MlxGpuLane` + `MATRIX_MLX_INPROC` + submit path only.
3. **Phase C/D** — stream + soak; close COF-79 / MS-161 epic slice.
4. **Open MS-68** — generalize registry + paged KV (Task 2); Flash as spike behind flag.
5. **Phase 2 pybind** — only when telemetry JSON is insufficient for policy experiments.

---

## Linear mapping

| Work | Linear |
|------|--------|
| MS-161 design + phases | COF-78 epic, COF-79 (re-scope to 10–15 pts) |
| MS-68 foundation | COF-38 (blocked by COF-79 Phase B) |
| MS-69+ regulation | COF-32, COF-39 (blocked by COF-38) |
