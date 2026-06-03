# Matrix Swarm

[![npm version](https://img.shields.io/npm/v/@keepdevops/matrix?style=flat-square&logo=npm&color=00ccff)](https://www.npmjs.com/package/@keepdevops/matrix)
[![npm downloads](https://img.shields.io/npm/dm/@keepdevops/matrix?style=flat-square&color=8a8a99&label=downloads)](https://www.npmjs.com/package/@keepdevops/matrix)
[![GitHub stars](https://img.shields.io/github/stars/keepdevops/matrix-project?style=flat-square&logo=github&color=00ff9d)](https://github.com/keepdevops/matrix-project)
[![License](https://img.shields.io/github/license/keepdevops/matrix-project?style=flat-square&color=8a8a99&v=2)](LICENSE)
[![Config generator](https://img.shields.io/github/actions/workflow/status/keepdevops/matrix-project/config-generator.yml?branch=main&style=flat-square&label=config%20generator)](https://github.com/keepdevops/matrix-project/actions/workflows/config-generator.yml)

> **The local-first multi-agent coding swarm.** Privacy-first, no cloud, no API keys —
> turns your Apple Silicon or NVIDIA box into a 16-agent dev team.

A multi-agent local-LLM workbench. Dispatches prompts to 16 specialised agents
(architect, programmer, security, reviewer, …) across four orchestration modes
(flat, pipeline, cascade, router) against local inference servers (llama.cpp,
MLX, vLLM). Supports multi-turn conversation threads, pgvector RAG context
injection, five UI layouts, per-agent circuit breakers, and a live metrics
dashboard — all in a React UI with no cloud dependency.

## How it compares

### vs. AI coding IDEs

| | Matrix Swarm | Cursor | Aider | Cline |
|---|---|---|---|---|
| Runs fully local | **Yes** | No | Optional | Optional |
| Multi-agent orchestration | **Yes (16)** | No | No | No |
| Mix backends per agent | **MLX + llama.cpp + vLLM** | No | No | No |
| Coordinator modes | **Flat · Pipeline · Cascade · Router** | — | — | — |
| Multi-turn conversation | **Yes (per-session threads)** | Yes | Yes | Yes |
| RAG / codebase context | **Yes (pgvector, per-agent)** | Yes | Yes | Partial |
| Open source | **Yes** | No | Yes | Yes |

### vs. MCP / agent frameworks

| | Matrix Swarm | CrewAI | LangGraph | AutoGen | OpenDevin | MetaGPT |
|---|---|---|---|---|---|---|
| Core focus | **Local coding / DevOps swarm** | Role-based crews | Stateful graph workflows | Conversational multi-agent | Autonomous coding agent | Software-company sim |
| Local-first / air-gapped | **Yes (default)** | Optional | Optional | Optional | Strong | Optional |
| Backends | **MLX + llama.cpp + vLLM mixable per agent** | Any | LangChain ecosystem | Multiple + local | Ollama / local | Any |
| Pre-built agents | **16+ specialised** | User-defined | Graph nodes | Dynamic | Single + tools | Fixed dev team |
| Orchestration | **Flat · Pipeline · Cascade · Router** | Sequential / hierarchical | Graph (loops, branches) | Message-based | Tool-loop | Pipeline |
| Multi-turn sessions | **Yes (ConversationThread)** | Yes | Yes | Yes | Yes | Limited |
| RAG | **Yes (pgvector, per-agent targeting)** | Optional | Optional | Optional | Yes | Optional |
| UI | **Real-time React + layouts + code editor** | CLI | Visualisation tools | AutoGen Studio | VS Code-like | CLI |
| Hardware tuning | **Apple Silicon (MLX) + CUDA presets** | Neutral | Neutral | Neutral | Good | Neutral |
| Time to first prompt | **`npm i -g`, then `matrix`** | Python crew kickoff | Graph definition | Convo setup | Docker + web UI | Python setup |

**Pick Matrix Swarm** when you want privacy, multi-backend mixing, multi-turn
conversation threads, and instant specialised coding agents on local hardware —
with no cloud dependency and no API keys. **Pick CrewAI / LangGraph / AutoGen**
when you need a programmable framework for non-coding workflows or custom agent
logic. **Pick OpenDevin** for deep terminal-driven autonomous coding — or combine
it with Matrix Swarm for parallel planning + deep execution.

```
┌──────────┐    ┌──────────┐    ┌─────────────────────────┐
│ React UI │───▶│  proxy   │───▶│  coordinator (C++)      │
│  :3000   │    │  :3002   │    │  :8000                  │
└──────────┘    └──────────┘    │  ├─ flat · pipeline ·   │
                                │  │  cascade · router    │
                                │  ├─ per-mode rosters    │
                                │  ├─ presets · breaker   │
                                │  ├─ SSE streaming       │
                                │  ├─ conversation threads│
                                │  └─▶ N agent backends   │
                                │      (llama / mlx / vllm)│
                                └──────────────┬──────────┘
                                               │ MLX agents
                                ┌──────────────▼──────────┐
                                │  C++ coordinator :3002  │
                                │  /api/mlx/* · native    │
                                └─────────────────────────┘
```

## Features

- **16 specialised agent roles** — architect, foreman, programmer, specialist,
  security, api, database, frontend, reviewer, tester, optimizer, debugger,
  devops, scout, synthesis, documenter. Each has a tuned system prompt and a
  colour in the UI.
- **Four orchestration modes** (selectable from the UI MODE menu):
  - `flat` — broadcast the prompt to every agent in parallel; no reducer.
  - `pipeline` — sequential chain; each agent receives the previous agent's
    output. Optional **synthesizer** agent runs last and consolidates all stage
    outputs into one final answer.
  - `cascade` — mixture-of-agents: parallel broadcast (like flat) followed by
    a synthesizer that reduces every response into one consolidated answer.
  - `router` — a classifier agent (foreman by default) picks up to
    `max_select` agents from the per-mode roster, enriched with a live
    `Current load: …` hint built from KV-cache pressure.
- **Three inference engines**, mixable in one swarm:
  - **LLAMA** — `llama-server` from llama.cpp; loads `.gguf` files; uses
    `--parallel N` so same-model agents share one process. Supports KV-cache clear.
  - **MLX** — `mlx_lm.server` (Apple Silicon / Metal); loads model directories;
    typically faster per-token on M-series. Handled natively by the C++ coordinator
    on `:3002` (`/api/mlx/*`); per-port serialisation and session management in C++.
  - **vLLM** — 4 servers via Docker Model Runner on ports 8080–8083
    (Qwen2.5-14B, Llama-3.2-3B, DeepSeek-Coder-V2, Phi-4-mini).
- **Per-agent model override** — point any agent at any model file/dir from the
  CONFIGURE panel.
- **Multi-turn conversation threads** — sessions auto-continue after the first
  BROADCAST. The `ConversationThread` panel shows the full turn history.
  Session state is persisted in `sessions.json` and reset by CLEAR KV.
- **UI layouts** — **Brewlate** is the default (`?layout=brewlate` or omit layout).
  Alternates: classic (legacy Matrix grid), dashboard, terminal, minimal, sidebar.
  `?layout=default` also resolves to Brewlate.
- **Visual layout editor** — flow, freeform, and grid editing modes with
  localStorage persistence for custom dashboard arrangements.
- **CodeMirror response viewer** — auto-language-detect, edit, copy, save. Each
  card has an expand (⤢) button for a full-screen editor.
- **Auto code extraction** — the `programmer` agent's first code block is pulled
  into a syntax-highlighted CODE OUTPUT pane below the grid (C++, Go, Python,
  JS, Rust, SQL, …).
- **Broadcast history** — last 10 prompts and full responses, click to reload.
- **CLEAR KV** — drop llama-server KV cache, restart MLX servers, and reset
  conversation session state between unrelated prompts.
- **SAVE CODE** — export every agent's code blocks to one timestamped file.
- **Pre-built swarm configs** — `swarm-config.json` (generated; see below),
  plus authored variants `swarm-config-16gb.json`, `swarm-config-32gb.json`,
  `swarm-config-8agents-text-image.json`.
- **Per-agent config source of truth** — edit `config/agents/<name>.json`
  (one file per agent) and `config/coordinator.json`, then run
  `python3 scripts/build_swarm_config.py` to regenerate `swarm-config.json`
  and its `public/` copy. Both are gitignored build artifacts;
  `scripts/stage-dist.sh` runs the generator automatically before publish.
  Agent JSONs use `${MATRIX_MODEL_DIR}/...` for model paths; the
  `SwarmFactory` loader and the build script expand these at load time
  and fail loudly on any unresolved `${VAR}`.
- **Per-mode agent rosters** — pick which agents participate in each mode from
  the **PER-MODE ROSTER** panel. Order matters in pipeline. Empty roster ⇒
  mode falls back to the full deployed swarm. Persists across coordinator
  restarts and (with `MATRIX_SOURCE_CONFIG` set) across UI redeploys.
- **Mode presets** — save the current mode + roster + synthesizer + max_select
  under a name (`design-review`, `router-fast`, …). One click switches modes
  and applies the bundle.
- **Live system-prompt editing** — pencil button next to each agent in
  CONFIGURE opens a textarea editor for that agent's `system_prompt`. Saves
  to active + source config; clears the response cache. The most useful lever
  on router quality is `foreman`'s system prompt.
- **Streaming SSE dispatch** — `/api/architect/stream {prompt, session_id?}`
  honours the active mode. The first event is always `session {session_id}`,
  used by the UI to wire follow-up BROADCASTs to the correct conversation
  thread. Pipeline emits `stage` events; router emits a `selected` event;
  cascade and pipeline emit `synthesis_start` when the reducer kicks in.
  A final `metrics` event carries per-agent timings.
- **Per-agent circuit breaker** — three failures in 60s open the breaker for
  30s; the agent is excluded from dispatch (and from streaming) until it
  recovers. Surfaces in `meta.excluded_unhealthy` and a red banner in the UI.
- **Retry + skip-with-warning** — one automatic retry (250ms backoff) on
  transient HTTP failures. Pipeline records failed stages in `meta.errors[]`
  and continues from the last good output instead of poisoning downstream.
  Cascade filters failed agents out of the synthesizer's input.
- **Per-run metrics dashboard** — every dispatch envelope carries
  `meta.timings { agent: { calls, total_ms, completion_tokens } }` and
  `meta.wall_ms`. The `MetricsStrip` component renders this as a per-agent
  bar chart below FINAL ANSWER. Themeable via the existing light/dark toggle.
- **RAG (opt-in)** — pgvector-backed retrieval injects relevant codebase
  chunks into the prompt before dispatch. Per-agent targeting, a coordinator
  hook for the C++ path, and a `brewctl rag` CLI for indexing and querying.
- **Integration test suite** — `bash tests/run.sh` runs ~30 end-to-end tests
  against a coordinator wired to mock agents (no real models needed). Covers
  every mode, streaming, breaker, presets, retry/skip, prompt editing.

## Requirements

- **macOS** (Apple Silicon recommended; Intel Macs can run LLAMA-only swarms).
- **Node ≥ 18 < 23, npm ≥ 9** — React UI and proxy.
- **Python ≥ 3.10** — `brewctl`, orchestration layer, MLX coordinator, and RAG pipeline.
- **C++17 toolchain (clang)** — `xcode-select --install` builds `coordinator` and `proxy`.
- **For LLAMA**: `llama-server` from llama.cpp on `PATH`.
- **For MLX**: `pip install mlx-lm` (Apple Silicon only). MLX routes are handled natively by the C++ coordinator — no separate Python process required.
- **For vLLM**: Docker Desktop with Model Runner enabled (GPU-accelerated containers on ports 8080–8083).
- **For RAG**: Docker Desktop for the pgvector container (`docker compose -f docker/pgvector/docker-compose.yml up -d`).
- **GGUF / MLX model files on disk.** Agent profiles reference models via `${MATRIX_MODEL_DIR}/...` (defaults to `/Users/Shared/llama/models` via `scripts/matrix-env.sh`). Override with `export MATRIX_MODEL_DIR=/your/path`, or set per-agent in the UI.

See **[docs/SETUP.md](docs/SETUP.md)** for a full prerequisites walkthrough and troubleshooting guide.

## Quick start

```bash
# 1. Build the C++ binaries (coordinator + proxy; modes → build/libmatrix_modes.a; matrix_config_service optional)
bash scripts/build_cpp_binaries.sh

# 2. (optional) load env defaults
source scripts/matrix-env.sh

# 3. Pre-flight check (ports, binaries, models)
python3 scripts/brewctl check

# 4. Launch — starts proxy (:3002) and React UI (:3000)
python3 scripts/brewctl launch

# 5. Open http://localhost:3000
#    → CONFIGURE → choose engine + agents → LAUNCH SWARM
#    → wait for ONLINE → type prompt → BROADCAST (Cmd+Enter)

# 6. Stop everything
python3 scripts/brewctl shutdown
```

The coordinator listens on `:8000` once **LAUNCH SWARM** has been clicked in
the UI. The proxy on `:3002` fronts both the coordinator API and the
inference servers. MLX agents are served natively by the C++ coordinator
at `:3002/api/mlx` — no separate Python process required.

## Standalone swarm-config editor

A self-contained guardrailed editor for `swarm-config.json` — useful when you
want to validate or restructure a config file outside the main React UI, or
before deploying to a new machine.

```bash
bash scripts/open-swarmconfig-editor.sh
# or open directly
open tools/swarmconfig-editor.html
```

**Validation enforced before export:**
- Strict JSON + schema checks (`root.agents[]`, required agent fields, numeric ranges)
- Unique/safe agent names; duplicate backend+port collision detection
- Model/path guardrails (blocks `..`, shell metacharacters, and other unsafe sequences)

Export is disabled until all blocking errors are resolved. The downloaded file is
normalised and saved as `swarm-config.validated.json`.

**Editing features:**
- Format / minify, copy all / copy validated, drag-and-drop JSON load
- Find/replace, go-to-line, word wrap, font size, light/dark theme
- Session restore via `localStorage` (survives page reload)
- Undo/redo for programmatic edits (toolbar + **⌘/Ctrl+Z** / **⌘/Ctrl+Shift+Z**)
- Merge JSON — agents merge by name; `coordinator`/`ui` blocks deep-merge
- Rename agent — updates name across roster, router, and pipeline lists
- Browser-side presets for frequently used config snippets
- Path check — basename match via File System Access API after picking a models folder
- Agent sidebar with jump links to each agent block
- Collapsible schema cheat sheet

**Keyboard shortcuts:**

| Shortcut | Action |
|---|---|
| **⌘/Ctrl+Enter** | Validate |
| **⌘/Ctrl+S** | Download when valid; re-validate otherwise |
| **⌘/Ctrl+G** | Go to line |
| **⌘/Ctrl+F** | Find |
| **⌘/Ctrl+Z** / **⌘/Ctrl+Shift+Z** | Undo / redo (when stack has entries) |

## NPM scripts

| Script | What it does |
|---|---|
| `npm start` | React dev server on `:3000` |
| `npm run build` | Production React build |
| `npm run build:bin` | Build C++ coordinator + proxy (`scripts/build_cpp_binaries.sh`) |
| `npm run stage:dist` | Bundle for npm publish (`scripts/stage-dist.sh`) |
| `npm test` | Run the component test suite once (no watch) |

Lifecycle (check / launch / shutdown) is handled by `python3 scripts/brewctl` — see [brewctl quickstart](#brewctl-quickstart).

## UI cheat sheet

- **MODE: FLAT/PIPELINE/CASCADE/ROUTER** — orchestration strategy (see Features).
- **CONFIGURE** — choose engine, agents, per-agent models, edit any agent's
  system prompt (✏️), then LAUNCH SWARM.
- **PER-MODE ROSTER** (inside CONFIGURE) — pick which agents participate in
  each mode. Synthesizer dropdown for pipeline + cascade. `max_select` slider
  for router. Save active state as a named **PRESET**, apply later in one click.
- **CLEAR KV** — wipe KV cache on llama agents and restart MLX servers; also
  resets conversation session state.
- **HISTORY (N)** — recall any of the last 10 broadcasts and their responses.
- **Temperature** — default `0.20`. Stay in `0.10–0.25` for code; `0.40–0.70`
  only for open-ended brainstorming.
- **BROADCAST / Cmd+Enter** — send the prompt under the active mode.
  `Shift+Enter` inserts a newline.
- **ConversationThread** — collapsible panel showing the multi-turn session
  history. Sessions auto-continue after the first BROADCAST.
- **Layout switcher** — Brewlate (default), classic, dashboard, terminal, minimal,
  sidebar — or append `?layout=<name>` to the URL.
- **RUN METRICS** — per-agent ms + token bars below FINAL ANSWER after every
  dispatch.
- **🔴 circuit breaker open** banner appears in PER-MODE ROSTER when any
  agent has tripped; cooldown counts down in seconds.
- **⤢ on a card** — open that agent's full response in a CodeMirror editor.
- **SAVE CODE** — dump all extracted code to a timestamped file.
- **?** — in-app help modal; links to full docs.

## Tips

- **5–7 agents is the sweet spot for coding swarms.** 12–16 agents risks VRAM /
  KV-token exhaustion — reserve large swarms for high-level exploration.
- **CLEAR KV before every new major prompt.** The first prompt fills KV with
  context; a second unrelated prompt without clearing can leave agents reading
  contradictory instructions. CLEAR KV also resets MLX conversation state.
- **Temperature 0.10–0.25 for code.** Higher values cause agents to contradict
  each other or hallucinate new classes across a large parallel swarm.
- **Use `pipeline` for multi-step generation** (architect → programmer →
  reviewer) and `router` when only a subset of agents is relevant per prompt.
- **Use `cascade` for best-of-N.** Run agents in parallel then let the
  synthesizer pick the strongest parts of each response.
- **Save presets for recurring workflows.** Once you find a good mode + roster
  combination, save it as a preset to apply in one click next session.
- **Tune `foreman` for router quality.** The foreman system prompt is the main
  lever on classification quality — edit it live with ✏️ in CONFIGURE.
- **Mix LLAMA and MLX on Apple Silicon.** Add an MLX agent to a LLAMA swarm to
  compare Metal-optimised inference against llama.cpp on the same broadcast.

## Repository layout

```
src/                React UI (App, components, hooks, api)
  ├─ components/    Agent cards, modals, metrics, roster, RAG admin, …
  ├─ layouts/       Layout variants: brewlate (default)/classic/dashboard/terminal/minimal/sidebar
  └─ editor/        Visual layout editor (flow/freeform/grid) with persistence
cpp_core/src/       C++ coordinator + proxy + modes (flat/pipeline/cascade/router)
backends/           Python InferenceBackend ABC + per-engine adapters
                    (llama_cpp, mlx, vllm)
orchestration/      Python control plane
  ├─ manager.py     SwarmFactory: loads config/agents/*.json (Pydantic)
  ├─ mlx_coordinator/  Python MLX coordinator (DEPRECATED — use C++ native /api/mlx/* on :3002)
  │                    inference, session management, service helpers
  ├─ modes/         Plugin modes: flat/pipeline/cascade/router +
  │                 speculative/map_reduce/critic_debate/tree_of_thought
  ├─ telemetry/     structlog JSON logging + Prometheus /metrics
  └─ rag/           pgvector chunker / embedder / store / retrieve
config/
  ├─ system_cluster.yaml   Global infra (ports, modes, presets)
  └─ agents/*.json         One file per agent (split from swarm-config.json)
docker/pgvector/    docker-compose for Postgres+pgvector (RAG)
scripts/
  ├─ brewctl              Unified Python CLI (check/launch/shutdown/rag)
  ├─ build_cpp_binaries.sh  C++ build (targets cpp_core/src)
  ├─ build_swarm_config.py  Merge config/agents/*.json → swarm-config.json
  ├─ migrate_swarm_config.py  Split legacy swarm-config.json → config/agents/
  └─ rag-docker-compose.sh  pgvector stack wrapper (up/down/psql/nuke/…)
docs/               Documentation
  ├─ SETUP.md       Prerequisites, build, first-run walkthrough
  ├─ HELP.md        Quick-reference: controls, modes, agents, issues
  ├─ USER_MANUAL.md End-to-end usage guide
  └─ CAPABILITIES.md  Full API, SSE events, env vars, internals reference
public/             CRA static assets, models.json fallback
tools/              Standalone swarm-config guardrailed editor (HTML)
swarm-config*.json  Pre-tuned agent/model layouts read by the C++ coordinator
production/         Optional nginx UI (not required for dev)
```

### brewctl quickstart

```bash
# Pre-flight: verify ports, binaries, and models
python3 scripts/brewctl check

# Start proxy (:3002) and React UI (:3000)
python3 scripts/brewctl launch

# Stop everything
python3 scripts/brewctl shutdown
```

**RAG (requires Docker + pgvector):**

```bash
# Start the pgvector container (or use the convenience wrapper)
bash scripts/rag-docker-compose.sh up

# Index a directory (auto-runs on `brewctl launch` when container is running)
python3 scripts/brewctl rag index ./cpp_core --embedder hash

# Index multiple directories
python3 scripts/brewctl rag index ./cpp_core ./orchestration --embedder hash

# Query the index
python3 scripts/brewctl rag query "kv router" --embedder hash
python3 scripts/brewctl rag query "session management" --top-k 5 --embedder hash

# Re-index after code changes
python3 scripts/brewctl rag index . --embedder hash --force
```

`scripts/rag-docker-compose.sh` wraps the pgvector stack with subcommands:
`up`, `down`, `restart`, `logs`, `status`, `wait` (blocks until `pg_isready`),
`psql` (shell into `matrix_rag`), and `nuke` (down + volume wipe).
Auto-detects `docker compose` vs legacy `docker-compose`.

Conda env: `conda env update -n mlx-env -f environment.yml`.
Tests: `pytest tests/modes tests/telemetry tests/rag`.

### Coordinator RAG hook (opt-in)

When `swarm-config.json` carries a top-level `"rag"` block with `"enabled": true`,
the C++ coordinator injects retrieved context into every dispatch:

1. Embeds the prompt using the hash embedder (`cpp_core/src/rag_embed.cpp`,
   byte-matched against `orchestration/rag/embed.py:HashEmbedder`).
2. Runs a cosine-distance ANN query against the `chunks` table in pgvector.
3. Prepends a `<context source="rag">…</context>` block to the prompt before
   mode dispatch.

Hit metadata appears under `meta.rag` in the response envelope. Override the
DSN with `RAG_DSN=postgresql://...`. Only the `hash` embedder is wired into
the C++ coordinator; the MLX/bge semantic path remains Python-only (CLI).

**Per-agent targeting:** set `"use_rag": true` on individual agents in
`swarm-config.json` to inject RAG context only for those roles.

**Request-level override:**

```json
POST /api/architect { "prompt": "...", "use_rag": true, "rag_top_k": 5 }
```

**Config shape:**

```json
"rag": { "enabled": true, "top_k": 3, "min_score": 1.0, "embedder": "hash" }
```

`min_score` is a **cosine distance ceiling** — a hit is kept when
`distance <= min_score` (0 = identical, 1 = orthogonal, 2 = opposite).

| Embedder | Recommended `min_score` | Notes |
|---|---|---|
| `hash` (default) | `1.0` (no filter) | Distances cluster near 1.0 — anything stricter drops every hit. |
| MLX / `bge` / semantic | `~0.6` | True neighbors land at 0.1–0.5; noise at 0.8+. Tighten per-prompt via the UI slider. |

## Coordinator HTTP API (cheat sheet)

C++ coordinator on `:8000`. See [docs/CAPABILITIES.md](docs/CAPABILITIES.md) for the full reference.

| Method · Path | Purpose |
|---|---|
| `GET  /api/health` | Liveness check. |
| `GET  /api/agents` | Active agent list. |
| `GET  /api/modes` · `GET /api/modes/active` | List modes / read active. |
| `POST /api/modes/active {mode}` | Switch active mode. |
| `GET  /api/modes/<name>/agents` | Per-mode roster + synthesizer + max_select. |
| `PUT  /api/modes/<name>/agents {agents, synthesizer?, max_select?}` | Edit roster. |
| `GET  /api/presets` · `PUT /api/presets/<name>` · `DELETE /api/presets/<name>` · `POST /api/presets/<name>/apply` | Preset CRUD + apply. |
| `PUT  /api/agents/<name>/prompt {system_prompt}` | Live system-prompt edit; clears response cache; persists to active + source config. |
| `GET  /api/health/agents` | Per-agent circuit-breaker snapshot. |
| `GET  /api/pressure` | Per-port KV / queue pressure. |
| `POST /api/architect {prompt, temperature?, use_rag?, rag_top_k?, session_id?}` | Dispatch under active mode → `{mode, agents, final, meta}`. |
| `POST /api/architect/stream {prompt, session_id?}` | SSE dispatch. Events: `session`, `token`, `agent_done`, `stage` (pipeline), `selected` (router), `synthesis_start` (cascade/pipeline), `metrics`, `done`. |
| `POST /api/clear-cache` | Clear all KV slots and reset MLX session state. |
| `POST /api/cache/clear` · `POST /api/cache/config` · `GET /api/cache` | Response cache management. |

### Persistence model

| What | Where | Lifetime |
|---|---|---|
| Per-mode rosters, presets | Active config (`--config <path>`, default `~/.matrix/run/matrix-active-config.json`) | Survives coordinator restart. |
| Per-mode rosters, presets (durable) | Source config (`MATRIX_SOURCE_CONFIG=<path>`, e.g. `swarm-config.json`) | Survives UI redeploy — `proxy_configure` reads `coordinator.modes` + `coordinator.presets` from source on each deploy. |
| Agent system prompts | Both active + source config on every `PUT /api/agents/<name>/prompt` | Immediate + durable when `MATRIX_SOURCE_CONFIG` is set. |
| Conversation sessions | `sessions.json` in the project root | Persists across restarts; cleared per-session by CLEAR KV. |
| Response cache | In-memory; managed via `/api/cache/*` | Cleared on coordinator restart or explicit `POST /api/cache/clear`. |
| RAG index | pgvector `chunks` table (Docker container) | Persists across restarts; re-index with `brewctl rag index`. |

Set `MATRIX_SOURCE_CONFIG` to make mode/preset/prompt edits survive a UI redeploy:

```bash
export MATRIX_SOURCE_CONFIG=/path/to/swarm-config.json
python3 scripts/brewctl launch
```

## Tests

```bash
# C++ coordinator integration suite (mock agents, no real models, ~30 s)
bash tests/run.sh                 # full suite
bash tests/run.sh -k breaker      # filter by name
bash tests/run.sh -x              # stop on first failure

# Python unit + integration tests
pytest tests/modes tests/telemetry tests/rag

# MLX coordinator tests
pytest tests/mlx_coordinator

# Chaos suite (llama-server + MLX coordinator fault injection)
pytest tests/test_chaos.py
```

The C++ integration harness (`tests/conftest.py`) spins up mock agents on
isolated ports and runs the real coordinator binary — no real models needed.

| File | Coverage |
|---|---|
| `test_modes.py` | Dispatch shape for all four modes, roster overrides, synthesis. |
| `test_streaming.py` | SSE event taxonomy per mode, breaker × stream interaction. |
| `test_breaker.py` | 3-failure trip, cooldown, exclusion in `meta.excluded_unhealthy`. |
| `test_presets.py` | CRUD + apply + unknown-agent dropping. |
| `test_resilience.py` | Retry-on-transient, pipeline skip-with-warning, cascade filtering. |
| `test_metrics.py` | `meta.timings` population, reset between dispatches, streaming `metrics` event. |
| `test_prompts.py` | Live prompt edit takes effect on next dispatch. |
| `test_kv_pressure.py` | KV / queue pressure endpoint and router load hint. |
| `test_chaos.py` | Fault injection for llama-server + MLX coordinator (timeouts, crashes, port conflicts). |
| `test_build_swarm_config.py` | Config generation from `config/agents/*.json`. |
| `tests/mlx_coordinator/` | MLX coordinator serialisation, session management, service helpers. |
| `tests/modes/` | Python orchestration mode plugins (flat/pipeline/cascade/router + speculative/map_reduce/…). |
| `tests/rag/` | pgvector chunker, embedder, store, retrieve, hash embedder byte-match. |
| `tests/telemetry/` | structlog JSON output, Prometheus `/metrics` endpoint. |

## Documentation

- **[docs/SETUP.md](docs/SETUP.md)** — prerequisites, build steps, model paths, first-run walkthrough, and troubleshooting.
- **[docs/HELP.md](docs/HELP.md)** — quick-reference: UI controls, modes, agent roles, common issues.
- **[docs/USER_MANUAL.md](docs/USER_MANUAL.md)** — end-to-end usage guide: configuring swarms, orchestration modes, conversation threads, presets, RAG, layouts, metrics, resilience, and best practices.
- **[docs/CAPABILITIES.md](docs/CAPABILITIES.md)** — full API reference: every endpoint, SSE event taxonomy, env vars, circuit breaker constants, MLX coordinator, session management, layouts, and RAG internals.
- **In-app help (?)** — quick-start, UI controls, agent roles, and tips without leaving the browser.

## License

See repository.
