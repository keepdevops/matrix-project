# MS-69 — Token Regulation & Observability (Phase A)

**Branch:** `cursor/ms-69-sprint`  
**Epic:** Token Regulation & Observability (COF-30)  
**Points:** 27 · **Priority:** High  
**Depends on:** MS-68 MLX foundation (COF-38) — registry/paged KV/flash not merged; token ledger + adaptive controls already on `main`.

## Goal (Phase A)

Scaffold observability (RSS feeds) and document integration with existing regulation primitives. No full MS-68 registry wiring in this sprint.

## Deliverables (this branch)

| Item | Status |
|------|--------|
| `rss_generator.{h,cpp}` | Bounded per-category queue; `publish()` no-op when disabled |
| `coordinator.rss.enabled` | `swarm-config.template.json` — default `false` |
| Routes | `GET /api/rss/history`, `/config`, `/token-regulation` → RSS 2.0 XML |
| Hooks | `rss_generator::publish(category, title, description, link)` for future model_registry / paged_kv |
| `test_rss_generator` | XML validity, cap=3, concurrent publish |
| Sprint doc | This file |

## Existing code (do not duplicate)

| Module | Location | MS-69 role |
|--------|----------|------------|
| `adaptive_select` | `cpp_core/src/adaptive_select.h` | Used in dispatch; `meta.adaptive_select` explains factors |
| `symbolic_importance` | `cpp_core/src/symbolic_importance.h` | `meta.importance` / `avg_importance` post-dispatch |
| `token_ledger` | `token_ledger.{h,cpp}` | Session budgets (MS-68 token slice, shipped) |
| `context_gate` / `kv_auto_clear` | headers + dispatch | Prior MS-69 doc (`MS-69.md`) — already integrated |

## MS-68 dependency

- **On `main`:** Token budget, adaptive select, symbolic scoring, `mlx_model_registry` (MS-161 lane).
- **Not on `main`:** Generalized `model_registry`, `paged_kv_cache`, `flash_attention_wrapper` (see `MS-68-mlx-model-memory.md`, COF-38 Todo).
- **Branch `cursor/ms-68-sprint`:** No commits ahead of `main` at sprint start; MS-68 MLX work remains local/untracked.

## Config

```jsonc
"coordinator": {
  "rss": {
    "enabled": false,
    "max_items": 50
  }
}
```

## Deferred (Phase B+)

- Publish from `model_registry` load/evict and `paged_kv` page events
- RSS UI subscription / Foreman panel
- Prometheus counters for regulation events

## Test plan

```bash
./scripts/build_cpp_binaries.sh
./test_rss_generator
```

## Linear

- **COF-32** — retitled scope: Token Regulation observability (RSS Phase A); blockedBy **COF-38** for registry hooks.
- Epic tracker: **COF-30**.
