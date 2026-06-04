# Sprint Audit — 2026-06-04

**Scope:** Full-repo sweep of sprint completion + stale-branch cleanup.
**Main tip at audit:** `0486b85` (Merge #338).
**Method:** Each sprint/branch verified by *content* against `main` (not just
`git cherry` patch-ids, which flag squash/rebase merges as "unique" even when
the content already landed).

---

## 1. Sprint completion status

### ✅ Product / contract-test line — MS-24 → MS-92 (complete)
Continuous merge run from MS-24 through **MS-91** (entropy-guided KV eviction +
swarm negotiation) and **MS-92** (distillation app integration hooks — the
explicitly-tagged *"final backlog sprint"*, merged via #259). The product
backlog is finished.

### ✅ Research / architecture track — shipped on main
- MS-130, 137, 141, 146, 147 — MLX native port + gate fixes
- MS-149–154 — history injection, Python-vs-C++ benchmark, Metal embed spike,
  in-process 4B go/no-go
- MS-160 — concurrency gate: **NO-GO** for naive concurrent in-process inference
  (single GPU gives no throughput benefit; merged via #269)
- **MS-161** — in-process MLX inference epic. Shipped on main, gated behind
  `MATRIX_MLX_INPROC` + per-agent `dispatch:inproc`:
  - Phase A/B (registry + **serialized GPU lane**) → unified into
    `model_mem::ModelRegistry` (MS-68 Phase 2a, #277)
  - Phase B submit-wiring (`resolve_inproc`, `dispatch=="inproc"`) → #277
  - Phase C streaming → #271
  - Phase D resident-model snapshot/count + soak (`scripts/soak_coordinator.py`)
  - Main went *further* than the design branch: MS-171 Phase B idle-model
    reclaim + #297 eviction + MS-68 2b auto-resolution.
- MS-171 Phase A + Phase B — proactive memory-pressure eviction

### ℹ️ Not gaps
MS-93–129 and MS-131–148 have no docs and no branches — never numbered/planned,
not pending work. The active product series intentionally ends at MS-92.

---

## 2. MS-161 design-branch delta (investigated)

`ms-161-design` looked "10 commits ahead" but was **fully superseded**. Its only
branch-only files were the standalone `cpp_core/src/mlx_model_registry.{cpp,h}`,
which `#277` replaced with `model_mem::ModelRegistry` (main's own probe notes:
`#include "model_registry.h" // MS-68 Phase 2a: unified registry (was
mlx_model_registry.h)`). Every functional piece (serialized GPU lane, inproc
dispatch, streaming, resident surfacing, soak, all docs/tests) is on main via a
better API. **Merging would have regressed** to a dead API → branch deleted.

---

## 3. Stale-branch cleanup

All deletions were content-verified against `main` first. Tip SHAs recorded for
recovery (`git push origin <sha>:refs/heads/<name>` to restore a remote).

### Modularization sprints (superseded — main already < 300 LOC differently)
`MS-35` (empty), `MS-36`, `MS-38`, `MS-39`, `MS-40` — never merged, no docs;
main reduced every target file below the 300-LOC limit via a *different*
decomposition, so the branches' splits no longer applied.

> Follow-up from this audit: `coordinator_routes_dispatch.cpp` was the one file
> still over 300 LOC (373). Split into `coordinator_routes_dispatch_post.h`
> (handler → 246 LOC) via **#336**.

### Research branches
- `ms-161-design` — superseded (see §2)
- `ms-160-concurrency-scope` — fix already forward-ported; doc on main is the
  authoritative MEASURED+CORRECTED version (branch had the pre-measurement stub)

### Leftover sprint/fix branches (23 deleted: 11 local + 12 remote)

| Branch(es) | Disposition |
|---|---|
| `cursor/ms-37-sprint`, `ms-77`, `ms-68-foundation` | Merged (0 ahead) |
| `fix-ci-lint-warnings`, `ms-80`, `ms-31-sprint`, `cursor/ms-24-{memory-pressure-mvp,metrics-manifest-save,ui-flake-and-docs}` | Patch-equivalent on main |
| `chore-remove-dead-py-coordinator` | Target file already gone from main |
| `fix/llama-port-grouping` | Fix forward-ported via `8077e46` (#288) |
| `fix-monitor-kv-field` | Fix landed via #279 |
| `fix/brewlate-buttons-tests` | Pre-refactor `useBrewConfig`; main has newer `useBrewRoleHandlers` |
| `ms-68-phase2a`, `cursor/ms-68-sprint` | Obsolete standalone `mlx_model_registry`; unified into `model_mem` (#277) |
| `ms-76` | MS-76 + qualityPassTarget on main (+ #337) |
| `cursor/ms-24-code-output-rag-fix` | MS-24 long merged (269 behind) |

**Preserved:** `main`, `production` (release v2.0.12).
**Result:** branch list reduced to `main` + `production` only.

---

## 4. Related PRs merged this audit (2026-06-04)

| PR | Change | Merge |
|----|--------|-------|
| #336 | Split `coordinator_routes_dispatch.cpp` (373→246 LOC) into `dispatch_post` | `16392c5` |
| #337 | Resolve `qualityPassTarget` wiring artifacts (dupe decls/import/conflict markers) | `ff70479` |
| #338 | gitignore compiled C++ `test_*` binaries (+ untrack 7) | `0486b85` |
