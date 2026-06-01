# MS-54 Sprint: Preventive splits for files approaching 120 LOC

## Goal
Split files in the 149–159 LOC range before they cross the next ceiling.

## Files to Split

| File | Current LOC | Target |
|------|-------------|--------|
| `src/components/TokenBudgetPanel.js` | 159 | ≤110 |
| `src/components/SwarmConfig.risk.js` | 159 | ≤110 |
| `src/utils/codeExtractorFence.js` | 157 | ≤110 |
| `cpp_core/src/proxy_configure_spawn.cpp` | 157 | ≤110 |
| `src/layouts/MinimalLayout.js` | 155 | ≤110 |
| `scripts/demo_utils_broadcast.py` | 149 | ≤110 |

## Planned Splits

### 1. `TokenBudgetPanel.js` (159 LOC) → + `TokenBudgetRow.js`
Extract the per-agent token-budget row (slider, input, label) into a
`TokenBudgetRow` component.

### 2. `SwarmConfig.risk.js` (159 LOC) → + `SwarmConfig.risk.helpers.js`
Extract the raw scoring functions (VRAM estimation, port-conflict scorer,
engine-mix penalty) into `SwarmConfig.risk.helpers.js`. Keep the top-level
`computeRiskEstimate` orchestrator in `SwarmConfig.risk.js`.

### 3. `codeExtractorFence.js` (157 LOC) → + `codeExtractorFence.parse.js`
Extract the low-level fence-block parser and language-detection helpers into
`codeExtractorFence.parse.js`. Keep the public `extractFencedBlock` entry
point in `codeExtractorFence.js`.

### 4. `proxy_configure_spawn.cpp` (157 LOC) → + `proxy_configure_spawn_args.h`
Extract the argument-vector builder helpers (env expansion, flag assembly)
into an inline `spawn_args` namespace header. Keep the `spawn_process` public
API in `proxy_configure_spawn.cpp`.

### 5. `MinimalLayout.js` (155 LOC) → + `MinimalLayoutSidebar.js`
Extract the left sidebar (agent list, role toggles, deploy button) into a
`MinimalLayoutSidebar` component.

### 6. `demo_utils_broadcast.py` (149 LOC) → + `demo_utils_video.py`
Extract `stitch_video` and `wait_for_agents_ready` into `demo_utils_video.py`.
Keep `broadcast`, `wait_for_response`, and `follow_up` in
`demo_utils_broadcast.py`. Re-export from `demo_utils` for backwards compat.

## Acceptance Criteria
- All six source files ≤110 LOC after split
- New sub-modules each ≤110 LOC
- `pytest tests/test_modes.py tests/test_streaming.py -q` — 28 tests pass
- `npm test -- --watchAll=false` — 924 tests pass
- No import errors; backwards-compat re-exports updated in `demo_utils.py`
