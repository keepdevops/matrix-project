# Matrix Swarm — Capabilities Reference

Complete reference for everything the coordinator + UI can do beyond
"broadcast a prompt." Use the README for the quickstart; use this doc when
you need to know the exact endpoint, event, or knob.

---

## 1. Orchestration modes

The active mode determines how a single user prompt becomes one or more
agent calls. Switch with `POST /api/modes/active {mode}` or the **MODE**
header dropdown.

| Mode | Behaviour | Reducer? | Use when |
|---|---|---|---|
| `flat` | Broadcast in parallel to **every deployed agent** (ignores per-mode roster). | No (`final = null`) | Cross-reference different roles on the same question. |
| `pipeline` | Sequential chain. Each stage receives the previous stage's output. | Optional synthesizer; otherwise last stage is final. | Dependent steps: design → code → review. |
| `cascade` | Parallel broadcast (like flat) followed by a synthesizer reducer. | Required for non-null `final`. | Mixture-of-agents — best of parallel + a coherent answer. |
| `router` | Classifier picks ≤ `max_select` agents from the roster, only those run. | No (selected agents respond independently). | Save tokens when most agents aren't relevant. |

### Per-mode configuration

Each mode gets a config block under `coordinator.modes.<mode>` in the active
config file. Edit via `PUT /api/modes/<mode>/agents`:

```json
{
  "agents": ["architect", "programmer", "reviewer"],   // roster (order matters in pipeline)
  "synthesizer": "architect",                           // pipeline + cascade only
  "max_select": 3                                       // router only
}
```

Empty `agents` ⇒ mode falls back to the full deployed swarm (except **flat**:
flat mode **always** uses the full deployed swarm and ignores `agents` — use
pipeline/router/cascade rosters to limit participation).

The synthesizer agent does not double-execute as a chain stage — it's auto-
excluded from the parallel/sequential dispatch and runs once at the end with
all stage outputs.

### Response envelope (all modes)

Every `POST /api/architect` response is shaped as:

```json
{
  "mode": "pipeline",
  "agents": { "programmer": "...", "reviewer": "..." },
  "final": "optional combined text or null",
  "meta": { }
}
```

`Mode.run` in C++ (`cpp_core/src/modes/mode.h`) defines this contract. Session continuation and follow-ups reuse the same envelope on each run.

### Per-mode config keys (`coordinator.modes.<mode>`)

| Key | Modes | Purpose |
|-----|-------|---------|
| `agents` | pipeline, router, cascade | Ordered roster; duplicates allowed **only for pipeline** (repeat stages). |
| `order` | pipeline | Explicit stage sequence (optional). String array; duplicates allowed (e.g. programmer twice). If omitted or empty, order is derived from roster, then `preset`, then defaults. Persisted via `PUT /api/modes/pipeline/agents`. |
| `preset` | pipeline | Named preset (`code-quality`, `debug-fix`, `docs-finalize`) when no explicit `order` / roster chain is used. |
| `stage_context_chars` | pipeline | Soft limit for passing prior stage text forward. |
| `synthesizer` | pipeline, cascade | Reducer agent name (optional). |
| `synthesis_policy` | cascade | Reducer instruction style (`summary`, `full-code`, etc.). |
| `variant_policy` | flat | Prompt shaping (`standard`, `distinct`, `code-alternatives`). |
| `max_select` | router | Max agents the classifier may choose. |
| `classifier_policy` | router | Hint text for the classifier (`code`, `debug`, `docs`, `ops`, …). |

The namespace `mode_module` in C++ (`cpp_core/src/mode_module.h`) holds **shared helpers** (preset text, policy snippets). It is not the `Mode` struct — each mode still registers a `modes::register_mode({...})` entry.

### Stable `meta` fields (debugging / UI)

| Mode | Notable `meta` keys |
|------|---------------------|
| flat | `module`, `variant_policy`, `participants` |
| pipeline | `module`, `preset`, `order`, `stage_outputs`, `stage_compaction`, `errors`, synthesizer fields when used |
| cascade | `module`, `synthesis_policy`, `participants`, `synthesizer`, `errors`, `excluded` (agents skipped by synthesis due to failures) |
| router | `classifier`, `selected`, `classifier_policy`, … |
| all | `quality_pass` when the client sends `quality_pass: true` on a follow-up |

### Startup validation (`coordinator.modes` / `presets`)

On boot the coordinator logs **`[config] …`** for malformed types (for example `agents` not an array of strings, invalid `max_select`). An unknown **key** under `coordinator.modes` (a name that does not match a registered mode) produces a warning but the file still loads.

- C++: `cpp_core/src/config/coordinator_config_validate.cpp`
- UI reference (doc only): `src/config/coordinatorSchema.js`

### Optional config HTTP service (`matrix_config_service`)

A separate process that **owns** one `swarm-config.json` path, useful for
multi-process setups, CI pipelines, or shared config across machines.

**Build** (produced by `bash scripts/build_cpp_binaries.sh` when CMake finds its sources):

```bash
./build/matrix_config_service --config /path/to/swarm-config.json --port 8011
```

**Endpoints:**

| Method | Path | Behaviour |
|--------|------|-----------|
| `GET` | `/health` | `{"status":"ok"}` liveness check. |
| `GET` | `/api/v1/config` | Return the full JSON document. |
| `PUT` | `/api/v1/config` | Replace the document (shallow validation + atomic write). |

Port: `--port` flag or `MATRIX_CONFIG_SERVICE_PORT` env var (default **8011**).

**Coordinator integration:**

Set `MATRIX_SWARM_CONFIG_SERVICE=http://host:8011` in the coordinator's environment:
- Startup: coordinator loads config via `GET /api/v1/config` instead of reading `--config` from disk.
- Mode / preset edits: coordinator merges changes back via `GET → merge → PUT`.
- Agent rows and system prompts still dual-write to the local `--config` path unless you point everything at the shared service.

```bash
export MATRIX_SWARM_CONFIG_SERVICE=http://localhost:8011
python3 scripts/brewctl launch
```

### Pipeline staging prompt

Each non-first stage receives:

```
Original user request:
<<<
{user_prompt}
>>>

Previous step ({prev_agent}) produced:
<<<
{prev_output}
>>>

Continue the pipeline.
```

The synthesizer (when configured) gets the original prompt plus all stage
outputs labelled by agent name and is asked to produce a single
consolidated answer.

### Router classifier prompt

Built dynamically each request:

```
Allowed agents: <comma-separated roster>

Current load: programmer 12%, reviewer 0%, tester 80%. Prefer less-loaded
agents when multiple fit the task.

User request:
{user_prompt}

Respond with the SELECTED line only.
```

The load percentages come from `pressure::snapshot_pressure` (KV cache for
llama, queue depth for MLX). The classifier is asked to emit exactly:
`SELECTED: agent1, agent2, ...`. Names outside the roster are filtered out.

---

## 2. Mode presets

Named bundles of `(mode, agents, synthesizer?, max_select?)`. Saved under
`coordinator.presets` in the config file; survive restart and (with
`MATRIX_SOURCE_CONFIG`) UI redeploy.

| Endpoint | Effect |
|---|---|
| `GET /api/presets` | List all presets. |
| `PUT /api/presets/<name>` body `{mode, agents?, synthesizer?, max_select?}` | Create or overwrite. |
| `DELETE /api/presets/<name>` | Remove. |
| `POST /api/presets/<name>/apply` | Copy bundle into `modes_config[mode]`, set that mode active. Unknown agents are dropped and reported in `unknown[]`. |

UI: **PRESETS** panel inside CONFIGURE. "Save active as preset" captures
the active mode's current state under whatever name you type.

---

## 3. Live system-prompt editing

`PUT /api/agents/<name>/prompt {system_prompt}` updates the agent's prompt
in memory, rewrites both the active and source config files, and clears the
response cache (so old cached answers from the old prompt don't leak
through). Useful for tuning `foreman` — the single biggest lever on router
quality.

UI: pencil button (✏️) next to each agent in the CONFIGURE roles list opens
a textarea editor with char/word counter and "Revert to default".

---

## 4. Streaming dispatch (SSE)

`POST /api/architect/stream {prompt, session_id?}` runs the same dispatch as
`/api/architect` but emits Server-Sent Events. The event taxonomy depends on
the active mode:

| Mode | Event sequence |
|---|---|
| all | `session` (first) … |
| flat | `session` `token*` `agent_done*` `metrics` `done` |
| cascade | `session` `token*` `agent_done*` `synthesis_start` `token*` `agent_done` `metrics` `done` |
| pipeline | `session` (`stage` `token*` `agent_done`)<sup>×N</sup> [`synthesis_start` `token*` `agent_done`] `metrics` `done` |
| router | `session` `selected` `token*` `agent_done*` `metrics` `done` |

Event payloads:

- `session` — `{session_id}` — fires before the first token; the UI uses this to wire follow-up BROADCASTs to the correct conversation thread.
- `token` — `{agent, delta}`
- `agent_done` — `{agent}`
- `stage` — `{step, total, agent}` (pipeline only)
- `selected` — `{classifier, agents[]}` (router only)
- `synthesis_start` — `{agent}` (pipeline + cascade)
- `metrics` — `{agent: {calls, total_ms, completion_tokens, ...}}` (final)
- `done` — `[DONE]`

The streaming dispatch honours both the per-mode roster filter and the
circuit breaker — tripped agents are silently excluded.

---

## 5. Resilience

### Circuit breaker

Per-agent failure tracker. Constants in `agent_health.cpp`:
`WINDOW_MS = 60000`, `THRESHOLD = 3`, `COOLDOWN_MS = 30000`. Three failures
within the window trip the breaker; the agent is excluded from dispatch
until cooldown elapses, then the breaker is half-open and the next call
re-probes (success closes, failure re-opens).

| Surface | Where |
|---|---|
| Per-run exclusion | `envelope.meta.excluded_unhealthy: ["name", ...]` |
| Snapshot endpoint | `GET /api/health/agents` |
| UI | red banner in PER-MODE ROSTER, polled every 10 s |
| Coordinator log | `🔴 [health] <name> breaker TRIPPED (...)` / `🟢 [health] <name> breaker reset` |

### Retry-with-backoff

`agent_client.cpp` retries once (250 ms backoff) on transient HTTP failures:
5xx, empty 200 body, connect timeout, read timeout. 4xx never retries (it's
deterministic — wrong model, bad request). The breaker still counts the
final outcome.

### Skip-with-warning (pipeline)

A failed stage is recorded in `envelope.meta.errors[]` and pinned out of the
chain — the next stage receives the *previous good* output instead of the
error message. Without this, one timeout cascades garbage through the rest
of the pipeline.

```json
"meta": {
  "errors": [{"step": 2, "agent": "programmer",
              "detail": "[programmer error] context size exceeded"}]
}
```

### Synthesis safety (cascade)

Failed parallel agents are excluded from the synthesizer's input prompt and
recorded in `meta.errors[]`. The synthesizer never sees error markers.

---

## 6. Per-run metrics

Every dispatch envelope carries:

```json
"meta": {
  "wall_ms": 4231.7,
  "timings": {
    "architect":  {"calls": 1, "total_ms": 1820.4, "completion_tokens": 412},
    "programmer": {"calls": 1, "total_ms": 2104.2, "completion_tokens": 538}
  }
}
```

The streaming endpoint emits the same payload as a final `metrics` event
before `done`.

UI: **RUN METRICS** strip below FINAL ANSWER. One bar per agent, ranked by
`total_ms`, with per-agent ms / token counts and percentage of total agent
time. Themeable — adapts to the dark/light toggle.

Cache hits: `response_cache::lookup` short-circuits without recording, so a
fully-cached agent shows zero ms. Streaming token counts are word-counts
(SSE chunks don't carry `usage`); off by ~25–40% from a true tokenizer
count but fine for relative comparison.

---

## 7. Persistence

| What | Where | Lifetime |
|---|---|---|
| Per-mode rosters, presets | Active config (`--config <path>`, default `~/.matrix/run/matrix-active-config.json`) | Survives coordinator restart. |
| Per-mode rosters, presets (durable) | Source config (`MATRIX_SOURCE_CONFIG=<path>`, e.g. `swarm-config.json`) | Survives UI redeploy — `proxy_configure` reads `coordinator.modes` + `coordinator.presets` from source on each deploy. |
| Agent system prompts | Both active + source config on every `PUT /api/agents/<name>/prompt` | Immediate + durable when `MATRIX_SOURCE_CONFIG` is set. |
| Conversation sessions | `sessions.json` in the project root | Persists across restarts; cleared per-session by CLEAR KV. |
| Response cache | In-memory; managed via `/api/cache/*` | Cleared on coordinator restart or explicit `POST /api/cache/clear`. |
| RAG index | pgvector `chunks` table (Docker container) | Persists across restarts; re-index with `brewctl rag index`. |

If `MATRIX_SOURCE_CONFIG` is unset, only the active config is written — fine for
manual launches but per-mode edits will vanish on the next UI redeploy.

---

## 8. Coordinator HTTP API

| Method · Path | Purpose |
|---|---|
| `GET  /api/health` | Liveness check. |
| `GET  /api/agents` | Active agent list. |
| `GET  /api/modes` · `GET /api/modes/active` · `POST /api/modes/active` | List / read / set active mode. |
| `GET  /api/modes/<name>/agents` · `PUT /api/modes/<name>/agents` | Per-mode roster + synthesizer + max_select. |
| `GET  /api/presets` · `PUT /api/presets/<name>` · `DELETE /api/presets/<name>` · `POST /api/presets/<name>/apply` | Preset CRUD + apply. |
| `PUT  /api/agents/<name>/prompt {system_prompt}` | Live system-prompt edit; clears response cache; persists to active + source config. |
| `GET  /api/health/agents` | Per-agent circuit-breaker snapshot. |
| `GET  /api/pressure` | Per-port KV / queue pressure. |
| `POST /api/architect {prompt, temperature?, use_rag?, rag_top_k?, session_id?}` | Non-streaming dispatch → `{mode, agents, final, meta}`. |
| `POST /api/architect/stream {prompt, session_id?}` | Streaming SSE dispatch. First event is always `session {session_id}`. |
| `POST /api/clear-cache` | Clear all KV slots and reset MLX session state. |
| `POST /api/cache/clear` · `POST /api/cache/config` · `GET /api/cache` | Response cache management. |

Coordinator port defaults to 8000; override with `MATRIX_COORDINATOR_PORT`.

---

## 9. Tests

```bash
# C++ coordinator integration suite (mock agents, no real models, ~30 s)
bash tests/run.sh                          # full suite
bash tests/run.sh -k breaker               # filter by name
bash tests/run.sh -x                       # stop on first failure
bash tests/run.sh tests/test_streaming.py  # one file

# Python unit + integration tests
pytest tests/modes tests/telemetry tests/rag

# MLX coordinator tests
pytest tests/mlx_coordinator

# Chaos suite (fault injection for llama-server + MLX coordinator)
pytest tests/test_chaos.py
```

The C++ harness (`tests/conftest.py`) starts mock agents on isolated ports and
runs the real coordinator binary on port 18000. No real models needed — runs in ~30 s.

| File | Coverage |
|---|---|
| `test_modes.py` | Each mode's dispatch shape, roster overrides, synthesis, router classification + filtering. |
| `test_streaming.py` | SSE event taxonomy per mode (including `session` event), breaker × stream interaction. |
| `test_breaker.py` | 3-failure trip, cooldown, exclusion in `meta.excluded_unhealthy`. |
| `test_presets.py` | CRUD + apply + unknown-agent dropping. |
| `test_resilience.py` | Retry-on-transient, pipeline skip-with-warning, cascade filtering. |
| `test_metrics.py` | `meta.timings` populates, reset between dispatches, streaming `metrics` event. |
| `test_prompts.py` | Live prompt edit takes effect on next dispatch. |
| `test_kv_pressure.py` | KV / queue pressure endpoint and router load hint. |
| `test_chaos.py` | Fault injection for llama-server + MLX coordinator (timeouts, crashes, port conflicts). |
| `test_build_swarm_config.py` | Config generation from `config/agents/*.json`. |
| `tests/mlx_coordinator/` | MLX coordinator serialisation, session management, service helpers. |
| `tests/modes/` | Python orchestration mode plugins (flat/pipeline/cascade/router + speculative/map_reduce/…). |
| `tests/rag/` | pgvector chunker, embedder, store, retrieve, hash embedder byte-match. |
| `tests/telemetry/` | structlog JSON output, Prometheus `/metrics` endpoint. |

---

## 10. Environment variables

| Var | Default | Effect |
|---|---|---|
| `MATRIX_COORDINATOR_PORT` | `8000` | Coordinator listen port. Tests use 18000. |
| `MATRIX_PROXY_PORT` | `3002` | Proxy listen port. |
| `MATRIX_UI_PORT` | `3000` | React dev server port. |
| `MATRIX_MLX_COORDINATOR_PORT` | *(removed)* | Decommissioned — MLX routes served by C++ coordinator at `:3002` (MS-144). |
| `MATRIX_ACTIVE_CONFIG` | `~/.matrix/run/matrix-active-config.json` | Where the proxy stages the deployed config. |
| `MATRIX_SOURCE_CONFIG` | (unset) | If set, coordinator mirrors per-mode + preset edits to this path so they survive UI redeploy. |
| `MATRIX_MODEL_DIR` | `/Users/Shared/llama/models` (Darwin) | Root for model paths. Agent profiles under `config/agents/*.json` reference models via `${MATRIX_MODEL_DIR}/...`; the loader (`orchestration/manager.py`) and `scripts/build_swarm_config.py` expand the variable at load time and fail loudly on unresolved `${VAR}`. Also scanned by the proxy for model discovery. |
| `MATRIX_LLAMA_SERVER` | (resolved from PATH) | Path to `llama-server` binary. |
| `MATRIX_MLX_PYTHON` | (resolved) | Python interpreter that has `mlx_lm` installed. |
| `MATRIX_SYNTHESIS_MAX_PROMPT_TOKENS` | `1400` | Approximate max prompt size for pipeline/cascade/stream **synthesis** (concatenated agent outputs). Lower if synthesizer uses a small `--ctx-size`; raise when you increase model context. |
| `RAG_DSN` | (unset) | PostgreSQL DSN for the pgvector RAG store. Overrides the compiled-in default. |

---

## 11. MLX native C++ coordinator (MS-130, port 3002)

As of MS-130 (ship gate MS-146) the MLX inference path is served by the **native C++ coordinator** running at `:3002` alongside llama/vLLM agents.

> **MVP scope:** macOS Apple Silicon only. Linux production inference uses the llama.cpp / vLLM path unchanged. CUDA/CPU native support is deferred to epic MS-170.

Key behaviours:
- All `/api/mlx/*` routes handled by `coordinator_routes_mlx.cpp` (enabled by `-DMATRIX_MLX_NATIVE_COORD=1` at build time).
- Per-port `std::mutex` serialises HTTP calls to `mlx_lm.server` (single-threaded per instance).
- `MlxSessionStore` provides LRU session tracking with 300 s idle eviction, matching the Python `SessionStore` interface.
- Python orchestrate modes (`map_reduce`, `speculative`, `critic_debate`, `tree_of_thought`) continue via an in-process sidecar — they never use the native `/api/mlx/*` path.

**Routes (C++ native):**

| Route | Description |
|-------|-------------|
| `POST /api/mlx/submit` | Flat blocking dispatch; `{result, session_id}` |
| `POST /api/mlx/stream` | SSE stream; mode-aware (flat/pipeline/cascade) |
| `GET  /api/mlx/health` | Per-port health probe; `{ok, backends}` |
| `GET  /api/mlx/pressure` | Inflight counters + session snapshot |
| `GET  /api/mlx/agents` | MLX agent roster |
| `GET  /api/mlx/modes` | Available modes + active |
| `POST /api/mlx/modes/active` | Set active mode |
| `POST /api/mlx/session/clear` | Explicit session flush |

The legacy Python coordinator (`orchestration/mlx_coordinator/service.py`, `:3003`) is **decommissioned** as of MS-144 — it no longer starts on `brewctl up`.

---

## 12. Conversation / session management

Matrix Swarm supports multi-turn conversations per agent session.

- Each broadcast optionally continues an existing session (auto-continued from the UI after the first prompt).
- The `ConversationThread` component shows the full turn history in a collapsible panel.
- Session state persists in `sessions.json`; each session has an ID, agent roster, and message history.
- The streaming route emits a `session` SSE event carrying `{session_id}` before the first token so the UI can wire follow-ups to the correct session.
- `POST /api/architect/stream` with `{session_id}` continues the thread; without it a new session is created.
- CLEAR KV resets session state for all MLX servers (llama.cpp KV cache is cleared separately).

---

## 13. RAG (Retrieval-Augmented Generation)

### CLI indexing

```bash
# Start pgvector (convenience wrapper)
bash scripts/rag-docker-compose.sh up

# Index a directory (auto-runs on `brewctl launch` when container is running)
python3 scripts/brewctl rag index ./cpp_core --embedder hash

# Index multiple directories
python3 scripts/brewctl rag index ./cpp_core ./orchestration --embedder hash

# Re-index after code changes
python3 scripts/brewctl rag index . --embedder hash --force

# Query the index
python3 scripts/brewctl rag query "kv router" --embedder hash
python3 scripts/brewctl rag query "session management" --top-k 5 --embedder hash
```

`brewctl launch` auto-indexes the repo when the pgvector container is running.
Override the DSN with `RAG_DSN=postgresql://...`.

`scripts/rag-docker-compose.sh` subcommands: `up`, `down`, `restart`, `logs`,
`status`, `wait` (blocks until `pg_isready`), `psql` (shell into `matrix_rag`),
`nuke` (down + volume wipe). Auto-detects `docker compose` vs legacy `docker-compose`.

### Per-agent RAG targeting

Set `"use_rag": true` on individual agents in `swarm-config.json` to inject RAG context only for those agents. The `rag_top_k` field controls chunk count per agent.

### Coordinator RAG hook

When `swarm-config.json` carries `"rag": {"enabled": true}`, the C++ coordinator runs a cosine-distance ANN query and prepends a `<context source="rag">…</context>` block to the prompt before mode dispatch. Hit metadata appears in `meta.rag`.

| Embedder | Recommended `min_score` | Notes |
|---|---|---|
| `hash` (default) | `1.0` (no filter) | Distances cluster near 1.0 — stricter values drop all hits. |
| MLX / `bge` / semantic | `~0.6` | True neighbors land at 0.1–0.5; noise at 0.8+. |

Config shape: `"rag": { "enabled": true, "top_k": 3, "min_score": 1.0, "embedder": "hash" }`
