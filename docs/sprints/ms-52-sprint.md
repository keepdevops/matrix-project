# MS-52 Sprint: Preventive splits for files approaching 200 LOC

## Goal
Split files currently in the 160–195 LOC range before they cross the ceiling
during routine feature work.

## Files to Split

| File | Current LOC | Target |
|------|-------------|--------|
| `scripts/demo_utils.py` | 195 | ≤150 |
| `cpp_core/src/modes/router.cpp` | 175 | ≤150 |
| `cpp_core/src/coordinator_routes_modes_put.cpp` | 171 | ≤150 |
| `src/components/useSwarmConfigState.js` | 169 | ≤150 |
| `cpp_core/src/pressure_snapshot_llama.cpp` | 169 | ≤150 |

## Planned Splits

### 1. `demo_utils.py` (195 LOC) → `demo_utils.py` + `demo_utils_launch.py`
Extract profile selection, swarm launch, and mode-switch helpers
(`select_profile`, `launch_and_wait_online`, `set_mode`, `enable_rag`,
`clear_session`) into `demo_utils_launch.py`. Keep constants, `log`, `shot`,
`switch_right_tab`, and backwards-compat re-exports in `demo_utils.py`.

### 2. `router.cpp` (175 LOC) → `router.cpp` + `router_select.h`
Extract the agent-selection scoring helpers (score computation, candidate
filtering, tie-breaking) into `router_select.h` as `router_impl` inline
functions. Keep the `run_router` orchestrator and mode registration in
`router.cpp`.

### 3. `coordinator_routes_modes_put.cpp` (171 LOC) → split into
`coordinator_routes_modes_put.cpp` + `coordinator_routes_modes_agents.cpp`
Extract the per-mode agent assignment PUT handler into a dedicated translation
unit with its own header, keeping the mode-switch and mode-list PUT handlers
in the original file.

### 4. `useSwarmConfigState.js` (169 LOC) → `useSwarmConfigState.js` + `useSwarmConfigActions.js`
Extract the action callbacks (save, deploy, reset, port-change handlers) into
`useSwarmConfigActions.js`. Keep state declarations and derived values in
`useSwarmConfigState.js`.

### 5. `pressure_snapshot_llama.cpp` (169 LOC) → `pressure_snapshot_llama.cpp` + `pressure_snapshot_llama_parse.h`
Extract the llama metric-line parsing helpers into an inline header
`pressure_snapshot_llama_parse.h`. Keep the public snapshot API in the `.cpp`.

## Acceptance Criteria
- All five source files ≤150 LOC after split
- New sub-modules each ≤150 LOC
- `pytest tests/test_modes.py tests/test_streaming.py -q` — 28 tests pass
- `npm test -- --watchAll=false` — 924 tests pass
- No import errors; backwards-compat re-exports added where needed
