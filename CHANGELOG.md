# Changelog

All notable changes to this project will be documented in this file.

## [2.1.0] — 2026-05-31

### Added
- **Left panel agent expand** — agent cards show a `⤢` button and accent dot when a brewcast result is available; clicking opens the full response, timing metadata, and extracted code block in a popout modal (#59)

### Fixed

#### Coordinator wiring
- UI now reverts to the Configure panel when the coordinator goes offline — previously stayed locked in Session mode indefinitely (#60)
- Conversation history reloads automatically when the coordinator reconnects (#60)
- Agent card model/backend fallbacks refresh on reconnect, not only on page load (#62)
- `ModeRosterPanel` and `ModelConverter` now surface fetch failures to the user instead of silently logging (#62)

#### Streaming
- MLX stream handler now dispatches `selected`, `stage`, `synthesis_start`, and `session` events — `lastMeta`, `currentSession`, and pipeline stage outputs were never populated in MLX mode (#61)
- `onDone` fires exactly once per stream in both llama and MLX handlers — previously fired twice on a clean close causing a double state reset (#61)
- Full opts (`followup`, `qualityPass`, `useRag`, `ragTopK`, `ragMinScore`, `ragAgents`, `parentRunId`) now forwarded to the MLX request body (#61)
- Null `res.body` guard prevents a crash when a 200 response arrives with no body (#65)

#### Deploy flow
- Brew button shows `"Cannot reach the coordinator — is it running?"` instead of the raw browser `"Failed to fetch"` error (#67)
- `configureSwarm` validates that agents have `name` and `model` before hitting the network (#67)
- Stale "pending" agent status badges clear immediately on deploy failure (#64)
- Status poll interval now catches async throws instead of silently failing (#64)

#### State / unmount safety
- Active SSE stream is cancelled when the host component unmounts (#63)
- `RagAdmin` no longer updates state after the modal is closed mid-upload or mid-fetch (#63)
- Deploy poll interval stops cleanly on app teardown (#63)
- `agentMeta` staleness fixed — model/backend fallbacks stay current after coordinator reconfigure (#62)

#### Data correctness
- `staleAgents` in `useModeSave` now populated from `res.unknown` instead of always being `[]` (#66)
- `||` → `??` in `agentsApi.setModeAgents` — empty string values (e.g. clearing a synthesizer) no longer collapsed to `null` (#68)
- `ConversationThread` Turn keys use `??` fallback so a falsy `_run_id` is not treated as absent (#68)

#### UI / display
- `MetricsStrip` shows `0.00s` instead of `NaN s` when a timing row is missing `total_ms` (#65)
- `PipelineStageOutputs` key collision fixed for entries with duplicate step + agent combinations (#65)
- `useLayoutPreference` theme change no longer writes `localStorage` twice per switch (#65)
- `FileReader.onerror` handler added to `CodeDisplay` — file-open failures are now logged (#66)
- `PromptInput` ref-sync effect dependency array corrected (#66)
- Hardcoded `#ff7777`/`#ff8888` error colors replaced with `var(--brew-kv-crit)` in `PresetsPanel` and `CachePanel` (#64)
- API functions (`clearKvCache`, `fetchCacheStats`, `clearCache`, `fetchLogs`) log network errors before re-throwing (#65)

### Removed
- Dead `effective()` helper function removed from `TokenBudgetPanel` (#64)

---

## [2.0.14] — 2026-05-29

### Fixed
- Wire `kvFetchFailed` through to `PressureCluster` in monitor popout (#57)

### Changed
- Rename `matrixctl` → `brewctl` across all source files (#58)

---

## [2.0.13] — 2026-05-28

### Added
- BREW → Live tab auto-switch unified with agent results (#56)
- Brewlate UX frontend conversion and mode test coverage (#55)

### Fixed
- Show only deployed agents in help modal (#53)
- Hide mode descriptions in dropdown — show name only (#52)

---

## [2.0.12] — 2026-05-27

### Fixed
- Guard against multiple swarm instances clobbering each other on launch (#50)

---

## [2.0.11] — 2026-05-26

### Added
- Responsive layout for all devices + accessibility label fixes (#48)
- Playwright demo and hero demo scripts (#47)

### Fixed
- Replace `<p>` with `<div>` in `AgentMarkdown` to fix DOM nesting (#45)
- Guard async callbacks on unmount + mock missing `fetchModeAgents` (#44)

---

## [2.0.10] — 2026-05-24

### Added
- CVD-safe themes with accessibility and contrast fixes (#41)
- Dashboard, terminal, minimal, and sidebar layouts (#33, #32)
- Layout + theme switcher infrastructure (URL-based) (#33)
- MLX/llama hard backend barrier — Python MLX coordinator on port 3003 (#33)
- Per-agent RAG targeting and `extra_args` support (#33)
- GGUF → MLX standalone converter page with HuggingFace token support (#33)
- Foreman `SET_TOKENS` directives for dynamic agent budget adjustment (#33)
- Dynamic context thresholds from `coordinator.json` profiles (#33)
- Per-agent concurrency, `GET /api/metrics`, `POST /api/slots/evict` (#33)

### Fixed
- Resolve stale closure patterns flagged by eslint (#31)
- Validation, logging, and accessibility fixes for medium-severity issues (#30)
- Surface silent errors in `useModeHealth` and `RagAdmin` polling (#29)
- Stabilize inline objects and callbacks across layouts and components (#28)
- Circular import TDZ crash in `AppHeader` (#27)
- Button variant colors in light and CVD themes (#37, #38, #39)
- Polling interval jitter in `refreshAgents`/`refreshModes` (#21)
- Compare-variants cards clickable, send-best button wired (#17)
- Flat mode roster correctly honoured (#12)

### Changed
- Split `swarmApi.js` (812 LOC) into domain modules + extracted polling hook (#33)
- Split `ModeRosterPanel.js` (594 LOC) into focused modules (#33)
- Throttle streaming re-renders and memoize conversation tree (#23)
- Memoize render-path computations and stabilize `AppHeader` callbacks (#26)
- Migrate all buttons to token-based `Button` component (#33)
- Data-driven routing via agent tags (#33)

---

## [2.0.7] — 2026-05-10

### Added
- RAG admin panel, sources display, and health badge (#6)
- RAG coordinator integration with pgvector (#7)
- RAG ingest sidecar with job queue (#5)
- `matrixctl up/down` for full-stack bring-up and teardown (#13)
- RAG health route, in-process retrieval, and dispatch wiring (#7)
- Opt-in RAG retrieval over pgvector (#4)
- Use RAG context checkbox in `PromptInput` (#4)
- Auto-index repo on `matrixctl up` (#33)

### Fixed
- Inverted `min_score` distance comparison in RAG retrieval (#6)
- Preserve RAG block end-to-end so the badge goes green (#14)
- Flat mode must honour per-mode roster override (#12)
- `n_batch` support to cap peak GPU memory during inference (#18)
- Stop at chat-template turn markers — no more EOS leakage (#16)
- Share one Codestral-22B process across architect/programmer/tester (#15)
