# MS-53 Sprint: Preventive splits for files approaching 150 LOC

## Goal
Split files currently in the 150–166 LOC range before they cross the ceiling
during routine feature work.

## Files to Split

| File | Current LOC | Target |
|------|-------------|--------|
| `cpp_core/src/coordinator_routes_presets.cpp` | 166 | ≤130 |
| `src/hooks/useCoordinatorState.js` | 164 | ≤130 |
| `cpp_core/src/modes/cascade.cpp` | 163 | ≤130 |
| `src/layouts/BrewHeader.js` | 162 | ≤130 |
| `src/components/ModeRosterPanel.js` | 162 | ≤130 |
| `src/components/CachePanel.js` | 162 | ≤130 |

## Planned Splits

### 1. `coordinator_routes_presets.cpp` (166 LOC) → + `coordinator_routes_presets_impl.h`
Extract the preset-apply and preset-save helpers (JSON merge, validation,
persist-after-save) into an inline `presets_impl` namespace header.

### 2. `useCoordinatorState.js` (164 LOC) → + `useCoordinatorRefresh.js`
Extract `refreshModes`, `refreshAgents`, and `handleModeChange` into a
`useCoordinatorRefresh` hook that takes the state setters and returns the
callbacks.

### 3. `cascade.cpp` (163 LOC) → + `cascade_exec.h`
Extract the inner stage-dispatch loop and synthesizer call into inline
`cascade_exec` namespace helpers, matching the pattern used for pipeline.

### 4. `BrewHeader.js` (162 LOC) → + `BrewHeaderControls.js`
Extract the right-side control cluster (mode selector, profile selector,
deploy button, status pill) into a `BrewHeaderControls` component.

### 5. `ModeRosterPanel.js` (162 LOC) → + `ModeRosterRow.js`
Extract the per-mode roster row (agent chips, add/remove controls) into a
`ModeRosterRow` component.

### 6. `CachePanel.js` (162 LOC) → + `CachePanelStats.js`
Extract the cache statistics display (hit rate, size, eviction counters) into
a `CachePanelStats` component.

## Acceptance Criteria
- All six source files ≤130 LOC after split
- New sub-modules each ≤130 LOC
- `pytest tests/test_modes.py tests/test_streaming.py -q` — 28 tests pass
- `npm test -- --watchAll=false` — 924 tests pass
- No import errors; backwards-compat re-exports added where needed
