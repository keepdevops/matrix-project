# MS-68 Phase 2 — Scope

**Epic:** COF-38 Efficient Model Memory Management · **Follows:** Phase 1 (#273, scaffolding) + MS-69 Phase A (#272, RSS/regulation)
**Status:** SCOPE (not started) · **Date:** 2026-06-03

## Where Phase 1 left us

Phase 1 shipped *accounting + config scaffolding only* — nothing is wired into the live dispatch path yet:

- `model_mem::ModelRegistry` (`model_registry.{h,cpp}`) — pure `(model_id, quant)` **ref-count accounting**, always compiled, holds **no** model objects, **not referenced by the coordinator**. Tested standalone (`test_model_registry`).
- `Agent` fields: `dispatch` (`http`|`inproc`|`auto`), `quant`, `use_flash_attention`; `inference_backend:"auto"`.
- `paged_kv_cache` / `flash_attention_wrapper` — **stubs behind off-by-default flags** (`MATRIX_PAGED_KV_ENABLED`, `MATRIX_FLASH_ATTENTION_ENABLED`).

Meanwhile, **MS-161 already shipped a *real* in-process registry**: `mlx_inproc::MlxModelRegistry` holds resident Python MLX models keyed by **model path**, runs generation through a serialized GPU lane, and surfaces `snapshot()` on `/api/mlx/pressure` (under `MATRIX_MLX_INPROC`).

## The central decision — two registries, one job

We now have two overlapping registries:

| | `model_mem::ModelRegistry` (MS-68) | `mlx_inproc::MlxModelRegistry` (MS-161) |
|---|---|---|
| Compiled | always | only under `MATRIX_MLX_INPROC` |
| Holds | ref-counts by `(model_id, quant)` | actual resident Python models by path |
| Does | accounting / pressure | load + generate + stream |
| Snapshot | unused | on `/api/mlx/pressure` |

Phase 1's doc says the MS-68 registry is "designed to subsume MS-161 when merged."

**Decision (2026-06-03): Option B — merge.** Fold MS-161's `mlx_inproc::MlxModelRegistry` into `model_mem::ModelRegistry` behind **one interface**. The unified registry owns the keying (`model_id`+`quant`, generalizing MS-161's path-only key), the resident-model table, the serialized GPU lane, and `generate`/`generate_stream`. Under `MATRIX_MLX_INPROC` it holds real models; flag-off it degrades to pure accounting. This is the cleaner long-term shape and removes the duplicate-registry smell — at the cost of **rewriting a shipped, verified path** (MS-161 submit/stream).

> **Risk owned by this decision:** MS-161's in-process submit + streaming are already in production behind the flag. Merging rewrites that code, so every sub-phase that touches the registry **must re-run the MS-161 e2e regression** (inproc `/api/mlx/submit` cold+resident, `/api/mlx/stream` 32-chunk token stream, flag-off byte-identical) before it can land. Rejected Option A (layered accounting wrapper) was lower-risk but left two registries; not chosen.

## Sub-phases (each its own PR, ≤300 LOC, default `http` unchanged)

| # | Item | Risk | Exit criterion |
|---|------|------|----------------|
| **2a** ✅ | **Registry merge (Option B).** Move MS-161's resident-model table, serialized lane, and `generate`/`generate_stream` *into* `model_mem::ModelRegistry` behind one interface; generalize the key to `(model_id, quant)`. `/api/mlx/pressure` surfaces the unified snapshot **always** (not just under the flag); inproc routing in `coordinator_routes_mlx.cpp` retargets to the merged registry. | **Med–High** (rewrites shipped MS-161 path) | **MS-161 e2e regression passes** (inproc submit cold+resident, stream 32 chunks, flag-off byte-identical); pressure shows live ref-counts; unit tests. |
| **2b** ✅ | **`dispatch:"auto"` runtime.** Resolve `auto` → `inproc` when the embed path is built **and** the agent is eligible, else `http`. Log the decision (reuse `backend_router`, no duplicate routing). | Low | `auto` agent routes inproc on an INPROC build, http otherwise; explicit decision in dispatch meta; default still http. |
| **2c** ⚖️ | **Paged KV — SPIKE DONE → split verdict** ([findings](./ms-68-2c-paged-kv-spike.md)). | — | **NO-GO** on a custom Metal paged cache (mlx_lm owns the KV layer). **GO** on session prompt-cache reuse as a new sub-phase **2c′** — measured 4.5× per-turn at ~1.2k tokens, 34× at 10.8k (delta-feed pattern). Recommend deleting the `paged_kv_cache` stub. |
| **2d** | **Flash attention — spike.** `MATRIX_FLASH_ATTENTION_ENABLED` + fallback path; measure tok/s vs baseline. | **High / may be NO-GO** | Honest measured delta (à la MS-160). Gate or shelve based on data — no perf claims up front. |
| **2e** | **Python orchestration hooks** (optional, last). Sidecar / coordinator alignment for eviction signals. | Med | Deferred until 2a–2b prove the accounting surface. |

## Recommended order & effort

**2a → 2b first.** 2a (the merge) is the load-bearing foundation — do it first, gated on the MS-161 e2e regression, so the rewritten path is proven before anything builds on it (~5–8pt given the rewrite + re-verification). 2b adds the `auto` routing the config already advertises (~3pt). **Then decide on 2c/2d** as measured spikes (the bulk of remaining epic risk; treat like MS-160 — measure before committing). 2e last.

## Constraints honored

- Default `dispatch:"http"`; flag-off build byte-identical (the established MS-161 invariant).
- Reuse `inference_backend` / `backend_router` — no parallel routing logic.
- 2c/2d are **spikes**: report measured numbers, accept NO-GO outcomes.
- Files 250–300 LOC; split registry/pressure/routing where needed.
