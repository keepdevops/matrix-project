# MS-68 — MLX Shared Model Foundation (Paged KV + Flash Attention)

**Linear title:** Central MLX Model Registry + vLLM-MLX Style Paged KV Cache + Metal Flash Attention Integration  
**Epic:** Efficient Model Memory Management & Token Regulation Foundation  
**Branch:** `cursor/ms-68-sprint`  
**Points:** 34  
**Priority:** Critical — blocks MS-69+ token-regulation sprints  
**Platform:** macOS Apple Silicon (Metal) only in v1  

**Prerequisite:** MS-130 shipped · **MS-161 Phase B** (`MlxModelRegistry` + `MlxGpuLane` on `ms-161-design`)  
**Design alignment:** [MS-161-design.md](./MS-161-design.md) · [mlx-inference-roadmap.md](../architecture/mlx-inference-roadmap.md)  
**MS-160 constraint:** No concurrent in-process GPU — one serialized lane; MS-68 adds sharing + paged KV on top.  
**Supersedes (scope split):** MLX/memory portions of token-regulation MS-68; token ledger in [MS-68.md](./MS-68.md) (Task 4).

---

## Status — BLOCKED, not started

> ⛔ **This sprint is BLOCKED and entirely unbuilt.** It depends on MS-161
> Phase B (`MlxModelRegistry` + `MlxGpuLane`), which is **design-only**
> ([MS-161-design.md](./MS-161-design.md)) and itself gated behind MS-161
> **Phase A** (the OOM root-cause soak), which has not run. No `model_registry`
> source exists; no paged-KV or Flash-Attention code exists. Do not open this
> sprint until MS-161 Phase A passes and the in-process build-dependency
> decision is made. (An earlier revision listed Phase 0 "in progress" — that was
> incorrect; the MS-152/161 embed work is a spike + design, not production code.)

| Phase | Scope | State |
|-------|--------|-------|
| 0 | MS-161 embed + MS-160 concurrency | Spike + design only (NOT production; MS-161 gated) |
| 1 | Model registry + dispatch modes | Not started (no `model_registry` source) |
| 2 | Paged KV (prefix + importance eviction) | Not started |
| 3 | Flash Attention wrapper (flag + fallback) | Not started (idea only) |
| 4 | Token budgets + contracts (light) | ✅ shipped separately in #211 (see MS-68.md) |
| 5 | RAG trajectory + UI metrics | Not started |

---

## User stories

1. **Swarm user:** One MLX model instance per `(model_id, quant)` across inprocess / http / auto dispatch — 8–12 agents without VRAM duplication.
2. **Performance:** Paged KV with prefix caching + optional Metal Flash Attention for shared prefixes (system, RAG, memory).
3. **Token regulation:** Registry integrates hierarchical budgets, Agent Contracts, importance-aware eviction.
4. **Research:** Trajectory logs capture sharing, paged KV, Flash metrics, dispatch for distillation export.
5. **Observability:** MetricsStrip + Impact Dashboard show residency, KV hit rate, Flash efficiency, memory saved.

---

## Tasks

### Task 1 — Central model registry + per-agent dispatch (8 pts)

**Build on MS-161:** Rename/generalize `MlxModelRegistry` → `ModelRegistry` with `(model_id, quant)` keys and `ref_count`. Keep `MlxGpuLane` as the sole in-process GPU entry (see MS-160).

**Files:** `cpp_core/src/model_registry.h`, `model_registry.cpp` (or extend `mlx_model_registry.*`)

- `ModelHandle`: `mlx_model`, `PagedKVCache*`, `ref_count`, `model_id`, `use_flash_attention`
- `ModelRegistry::instance()` — `acquire_model` / `release_model` / `get_total_memory_usage`
- **Lock order:** `registry_mu` before enqueueing to `MlxGpuLane`; never hold lane mutex during acquire
- Extend agent config:

```json
{
  "name": "chat",
  "model": "mlx-community/Llama-3.1-70B-4bit",
  "quant": "4bit",
  "engine": "mlx",
  "dispatch": "inprocess",
  "use_flash_attention": true,
  "max_input_tokens": 8192
}
```

`dispatch`: `inprocess` | `http` | `auto` (fallback to http if embed unavailable).

**Integrates with:** `mlx_embed_generate.cpp` (replace ad-hoc single-model load).

---

### Task 2 — Paged KV cache (10 pts)

**Files:** `paged_kv_cache.h`, `paged_kv_cache.cpp`

- `KVPage`: k/v tensors, `token_count`, `importance_score`, `content_hash`, `is_shared_prefix`
- `PagedKVCache`: allocate, `get_prefix(prefix_hash)`, `evict_low_importance`, `update_importance`
- Metrics: `get_hit_rate()`, `get_memory_bytes()`
- Default page size: 256 tokens (configurable)

---

### Task 3 — Metal Flash Attention wrapper (6 pts)

**Files:** `flash_attention_wrapper.h`, `flash_attention_wrapper.cpp`

- `FlashAttentionWrapper::is_supported()` — runtime probe
- `compute_attention_paged(model, pages, query, causal, temperature)`
- Wire in generation path (`agent_stream` / mlx embed dispatch) behind `use_flash_attention`
- **Fallback:** standard MLX attention when unsupported or flag off

**Risk R2:** kernel instability — feature flag `coordinator.advanced_model_optimization.enabled`

---

### Task 4 — Token regulation foundations (4 pts)

- Hierarchical `token_budget` + lightweight `agent_contract` (see MS-68.md)
- Foreman prompt: model sharing + paged KV / Flash status
- Supervisor hook: `paged_cache.evict_low_importance(threshold)`

---

### Task 5 — RAG trajectory logging (3 pts)

Extend trajectory export with:

- dispatch mode
- paged KV hit/miss + eviction reason
- Flash usage + tile efficiency (if available)
- model memory residency

---

### Task 6 — UI observability (3 pts)

**Files:** `MetricsStrip.js`, Impact Dashboard

- Shared models count
- Paged KV hit rate
- Flash speedup % (when measured)
- Estimated memory saved

---

## Definition of done

- [ ] Single MLX residency per `(model_id, quant)` across dispatch modes
- [ ] Paged KV: prefix cache + importance eviction operational
- [ ] Flash path optional with safe fallback
- [ ] `dispatch` + `auto` fallback in coordinator.json validation
- [ ] Light contracts + token budgets wired to registry pressure
- [ ] Trajectory export includes new fields
- [ ] UI metrics visible behind feature flag
- [ ] `docs/model-management.md` + CAPABILITIES § update

---

## Tests

| Layer | Tests |
|-------|--------|
| Unit | `test_model_registry.cpp`, `test_paged_kv_cache.cpp`, `test_flash_attention.cpp` |
| Integration | Mixed swarm (4 inprocess + 4 http), long RAG session prefix hits |
| Performance | Memory before/after (32/64 GB); tok/s with/without Flash |
| Manual | 10+ agents no OOM; Explain Decision shows KV/Flash rationale |

---

## Acceptance targets

- ≥35% memory reduction vs duplicate `mlx_lm.server` on same model
- ≥25% faster attention on long shared-prefix contexts (when Flash enabled)
- Graceful degradation when flags off

---

## Risk matrix

| ID | Risk | L | I | Mitigation |
|----|------|---|---|------------|
| R1 | Paged KV concurrency | M | H | Per-handle locking; chaos tests |
| R2 | Flash kernel instability | M | H | Flag + fallback |
| R3 | Dispatch regression | L | H | Full mlx_coordinator regression |
| R4 | Binary size | L | M | Optional compile unit |
| R5 | Bad eviction heuristics | M | M | Tunable page size + weights |

---

## Sequencing vs MS-161

```text
MS-161 Phase A (OOM soak) ──► Phase B registry+lane ──► MS-68 generalize registry + paged KV ──► MS-69+
```

MS-68 Task 1 is **not** parallel work — it generalizes MS-161-B. Flash (Task 3) is a spike, not a ship blocker.

---

## Linear

- **Epic/issue:** COF-38 (update title/body to this spec)
- **Blocks:** MS-69+ (COF-32, COF-39, …)
- **Depends on:** MS-146 ✅ · MS-161 Phase 1 (COF-79)
