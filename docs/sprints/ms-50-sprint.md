# MS-50 Sprint: Split demo_utils, hero_mlx, demo_playwright

## Goal
Bring all script files under the 250 LOC ceiling by splitting the three
largest scripts into focused sub-modules.

## Files to Split

| File | Current LOC | Target |
|------|-------------|--------|
| `scripts/demo_utils.py` | 323 | ≤250 |
| `scripts/hero_mlx.py` | 272 | ≤250 |
| `scripts/demo_playwright.py` | 263 | ≤250 |

## Planned Splits

### 1. `demo_utils.py` (323 LOC) → `demo_utils.py` + `demo_utils_render.py`
Extract rendering/display helpers (table formatting, color output, progress
display) into `demo_utils_render.py`. Keep data-fetch and shared primitives
in `demo_utils.py`. Re-import from `demo_utils` for backwards compat.

### 2. `hero_mlx.py` (272 LOC) → `hero_mlx.py` + `hero_mlx_runner.py`
Extract the MLX inference loop and result aggregation into
`hero_mlx_runner.py`. Keep CLI entry point and argument parsing in
`hero_mlx.py`.

### 3. `demo_playwright.py` (263 LOC) → `demo_playwright.py` + `demo_playwright_actions.py`
Extract page-interaction helpers (click sequences, form fills, screenshot
capture) into `demo_playwright_actions.py`. Keep browser launch/teardown
and main scenario orchestration in `demo_playwright.py`.

## Acceptance Criteria
- All three files ≤250 LOC after split
- New sub-modules each ≤250 LOC
- `pytest tests/test_modes.py tests/test_streaming.py -q` — 28 tests pass
- `npm test -- --watchAll=false` — 924 tests pass
- No import errors in any split file
