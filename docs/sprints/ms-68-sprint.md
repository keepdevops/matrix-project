# MS-68 Sprint — Efficient Model Memory Management Foundation

**Branch:** `cursor/ms-68-sprint` · **Linear:** COF-38 · **29 pts** · **Critical**  
**Strategy:** C++ core + Python orchestration · **Epic:** Efficient Model Memory Management Foundation

## Phase A — Config hygiene ✅ (this PR)

- [x] `swarm-config.template.json` with sensible defaults
- [x] `swarm-config.json` gitignored (existing)
- [x] `scripts/setup-config.sh`
- [x] C++ loader fallback: local config → template + stderr hints
- [x] `docs/configuration.md` migration section

## Phase B — C++ scaffolding ✅ (foundation only)

- [x] `model_registry.{h,cpp}` — `(model_id, quant)` keys, ref_count, pressure snapshot JSON
- [x] `Agent` + `coordinator_setup_wire` — `dispatch`, `quant`, `use_flash_attention`
- [x] Stub `paged_kv_cache`, `flash_attention_wrapper` (feature flags off)
- [x] `tests/cpp/test_model_registry.cpp` + `build_cpp_binaries.sh`

**Not in scope:** full MLX embed, lane integration, coordinator links to registry.

## Phase C — Docs ✅

- This file + `docs/configuration.md`

## Phase 2 (remaining)

| Item | Notes |
|------|--------|
| Wire `ModelRegistry` into dispatch / `MlxGpuLane` | Generalize MS-161 `MlxModelRegistry` |
| Paged KV Metal backing | `MATRIX_PAGED_KV_ENABLED`, prefix + eviction |
| Flash Attention spike | `MATRIX_FLASH_ATTENTION_ENABLED`, fallback path |
| `dispatch: auto` runtime | Embed probe → inproc vs http |
| Pressure API | Expose registry snapshot on `/api/mlx/pressure` |
| Python orchestration hooks | Sidecar / coordinator alignment |

## Constraints honored

- Default `dispatch: http` unchanged
- Reuses `inference_backend` / `backend_router` (no duplicate routing)
- Registry designed to subsume MS-161 in-process registry when merged
