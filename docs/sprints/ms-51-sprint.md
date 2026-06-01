# MS-51 Sprint: Split coordinator_config_validate, hero_demo, hero_expand, pipeline

## Goal
Bring all remaining files approaching the 250 LOC ceiling under the limit.

## Files to Split

| File | Current LOC | Target |
|------|-------------|--------|
| `cpp_core/src/config/coordinator_config_validate.cpp` | 223 | ≤200 |
| `scripts/hero_demo.py` | 210 | ≤200 |
| `scripts/hero_expand.py` | 205 | ≤200 |
| `cpp_core/src/modes/pipeline.cpp` | 202 | ≤200 |

## Planned Splits

### 1. `coordinator_config_validate.cpp` (223 LOC) → `coordinator_config_validate.cpp` + `coordinator_config_validate_agents.cpp`
Extract per-agent validation logic (port conflict checks, model path checks,
agent field validators) into `coordinator_config_validate_agents.cpp`.
Keep top-level config schema validation and coordinator-wide checks in the
original file.

### 2. `hero_demo.py` (210 LOC) → `hero_demo.py` + `hero_demo_runner.py`
Extract the per-scenario run logic (broadcast sequence, follow-up, screenshot
labeling) into `hero_demo_runner.py`. Keep CLI entry point and browser
lifecycle in `hero_demo.py`.

### 3. `hero_expand.py` (205 LOC) → `hero_expand.py` + `hero_expand_actions.py`
Extract expand-panel interaction helpers (open panel, navigate sections,
screenshot) into `hero_expand_actions.py`. Keep scenario orchestration and
main in `hero_expand.py`.

### 4. `pipeline.cpp` (202 LOC) → `pipeline.cpp` + `pipeline_exec.cpp`
Extract stage execution helpers (run_stage, error propagation, result
accumulation) into `pipeline_exec.cpp` with a matching `pipeline_exec.h`.
Keep the pipeline orchestrator and public API in `pipeline.cpp`.

## Acceptance Criteria
- All files ≤200 LOC after split
- New sub-modules each ≤200 LOC
- `pytest tests/test_modes.py tests/test_streaming.py -q` — 28 tests pass
- `npm test -- --watchAll=false` — 924 tests pass
- C++ build script updated if new translation units added
