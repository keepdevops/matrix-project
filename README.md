# Matrix Swarm

[![npm version](https://img.shields.io/npm/v/@keepdevops/matrix?style=flat-square&logo=npm&color=00ccff)](https://www.npmjs.com/package/@keepdevops/matrix)
[![npm downloads](https://img.shields.io/npm/dm/@keepdevops/matrix?style=flat-square&color=8a8a99&label=downloads)](https://www.npmjs.com/package/@keepdevops/matrix)
[![GitHub stars](https://img.shields.io/github/stars/keepdevops/matrix-project?style=flat-square&logo=github&color=00ff9d)](https://github.com/keepdevops/matrix-project)
[![License](https://img.shields.io/github/license/keepdevops/matrix-project?style=flat-square&color=8a8a99&v=2)](LICENSE)
[![Config generator](https://img.shields.io/github/actions/workflow/status/keepdevops/matrix-project/config-generator.yml?branch=main&style=flat-square&label=config%20generator)](https://github.com/keepdevops/matrix-project/actions/workflows/config-generator.yml)

> **The local-first multi-agent coding swarm.** Privacy-first, no cloud, no API keys —
> turns your Apple Silicon or NVIDIA box into a 16-agent dev team.

A multi-agent local-LLM workbench. Broadcasts a single prompt to many specialised
agents (architect, programmer, security, reviewer, …) running in parallel against
local inference servers (llama.cpp, MLX, vLLM), then collects, displays, and
extracts code from their responses in a React UI.

## How it compares

### vs. AI coding IDEs

| | Matrix Swarm | Cursor | Aider | Cline |
|---|---|---|---|---|
| Runs fully local | **Yes** | No | Optional | Optional |
| Multi-agent orchestration | **Yes (16+)** | No | No | No |
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

**Pick Matrix Swarm** when you want privacy, multi-backend mixing, and instant
specialised coding agents on local hardware. **Pick CrewAI / LangGraph / AutoGen**
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
                                │  MLX coordinator (Py)   │
                                │  :3003  · serialised    │
                                └─────────────────────────┘
```

## Features

- **16+ specialised agent roles** — architect, foreman, programmer, specialist,
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
    typically faster per-token on M-series. Routes through a dedicated Python
    coordinator on `:3003` with per-server request serialisation and session caps.
  - **vLLM** — 4 servers via Docker Model Runner on ports 8080–8083
    (Qwen2.5-14B, Llama-3.2-3B, DeepSeek-Coder-V2, Phi-4-mini).
- **Per-agent model override** — point any agent at any model file/dir from the
  CONFIGURE panel.
- **Multi-turn conversation threads** — sessions auto-continue after the first
  BROADCAST. The `ConversationThread` panel shows the full turn history.
  Session state is persisted in `sessions.json` and reset by CLEAR KV.
- **Five UI layouts** — switch between default, dashboard (metrics-first),
  terminal (dense), minimal (single-column), and sidebar (roster + content)
  via the header switcher or `?layout=<name>` in the URL.
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
- **Streaming SSE dispatch** — `/api/architect/stream` honours the active
  mode. Pipeline emits `stage` events; router emits a `selected` event;
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
  hook for the C++ path, and a `matrixctl rag` CLI for indexing and querying.
- **Integration test suite** — `bash tests/run.sh` runs ~30 end-to-end tests
  against a coordinator wired to mock agents (no real models needed). Covers
  every mode, streaming, breaker, presets, retry/skip, prompt editing.

## Requirements

- **macOS** (Apple Silicon recommended; Intel Macs can run LLAMA-only swarms).
- **Node ≥ 18 < 23, npm ≥ 9** — React UI and proxy.
- **Python ≥ 3.10** — `matrixctl`, orchestration layer, MLX coordinator, and RAG pipeline.
- **C++17 toolchain (clang)** — `xcode-select --install` builds `coordinator` and `proxy`.
- **For LLAMA**: `llama-server` from llama.cpp on `PATH`.
- **For MLX**: `pip install mlx-lm` (Apple Silicon only). The Python MLX coordinator runs on `:3003` and handles all MLX inference with per-server serialisation.
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
python3 scripts/matrixctl check

# 4. Launch — starts proxy (:3002), React UI (:3000), and MLX coordinator (:3003) if MLX agents are configured
python3 scripts/matrixctl launch

# 5. Open http://localhost:3000
#    → CONFIGURE → choose engine + agents → LAUNCH SWARM
#    → wait for ONLINE → type prompt → BROADCAST (Cmd+Enter)

# 6. Stop everything
python3 scripts/matrixctl shutdown
```

The coordinator listens on `:8000` once **LAUNCH SWARM** has been clicked in
the UI. The proxy on `:3002` fronts both the coordinator API and the
inference servers. The MLX coordinator runs separately on `:3003` when MLX
agents are deployed.

## Standalone swarm-config editor

Use the standalone guardrailed editor when you want to edit `swarm-config.json`
outside the main React UI:

```bash
open tools/swarmconfig-editor.html
# or
bash scripts/open-swarmconfig-editor.sh
```

What it enforces before export:
- strict JSON + schema checks (`root.agents[]`, required agent fields, numeric ranges)
- unique/safe agent names and duplicate backend+port collision checks
- model/path guardrails (blocks unsafe sequences like `..`, shell metacharacters)

Export is disabled until all blocking errors are fixed. The downloaded file is
normalized and saved as `swarm-config.validated.json`.

Editor UX includes format/minify, copy all / copy validated, drag-and-drop JSON,
find/replace, word wrap, font size, light/dark theme, session restore via
`localStorage`, a toolbar validation chip, and shortcuts: **⌘/Ctrl+Enter** validate,
**⌘/Ctrl+S** download when valid (otherwise re-validate), **⌘/Ctrl+G** go-to-line,
**⌘/Ctrl+F** find.

Additional tools: **undo/redo** for programmatic edits (toolbar + **⌘/Ctrl+Z** /
**⌘/Ctrl+Shift+Z** when the stack has entries); **merge JSON** (agents merge by
name, coordinator/ui deep-merge); **rename agent** across roster + router/pipeline
lists; **presets** stored in the browser; **path check** after picking a models
folder (basename match via File System Access API); **agent sidebar** jump links;
and a collapsible **schema cheat sheet**.

## NPM scripts

| Script | What it does |
|---|---|
| `npm start` | React dev server on `:3000` |
| `npm run build` | Production React build |
| `npm run build:bin` | Build C++ coordinator + proxy (`scripts/build_cpp_binaries.sh`) |
| `npm run stage:dist` | Bundle for npm publish (`scripts/stage-dist.sh`) |
| `npm test` | Run the component test suite once (no watch) |

Lifecycle (check / launch / shutdown) is handled by `python3 scripts/matrixctl` — see [matrixctl quickstart](#matrixctl-quickstart).

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
- **Layout switcher** — cycle between default / dashboard / terminal / minimal
  / sidebar layouts, or append `?layout=<name>` to the URL.
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
  ├─ layouts/       Layout variants: default/dashboard/terminal/minimal/sidebar
  └─ editor/        Visual layout editor (flow/freeform/grid) with persistence
cpp_core/src/       C++ coordinator + proxy + modes (flat/pipeline/cascade/router)
backends/           Python InferenceBackend ABC + per-engine adapters
                    (llama_cpp, mlx, vllm)
orchestration/      Python control plane
  ├─ manager.py     SwarmFactory: loads config/agents/*.json (Pydantic)
  ├─ mlx_coordinator/  Python MLX coordinator (port 3003) — serialised MLX
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
  ├─ matrixctl              Unified Python CLI (check/launch/shutdown/rag)
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

### matrixctl quickstart

```bash
# Pre-flight: verify ports, binaries, and models
python3 scripts/matrixctl check

# Start proxy (:3002), React UI (:3000), and MLX coordinator (:3003)
python3 scripts/matrixctl launch

# Stop everything
python3 scripts/matrixctl shutdown

# RAG over pgvector (requires Docker)
docker compose -f docker/pgvector/docker-compose.yml up -d
python3 scripts/matrixctl rag index ./cpp_core --embedder hash
python3 scripts/matrixctl rag query "kv router" --embedder hash
```

Convenience wrapper for the pgvector stack: `scripts/rag-docker-compose.sh`
exposes `up`, `down`, `restart`, `logs`, `status`, `wait` (blocks on
`pg_isready`), `psql` (shell into `matrix_rag`), and `nuke` (down + volume
wipe). Auto-detects `docker compose` vs legacy `docker-compose`.

Conda env: `conda env update -n mlx-env -f environment.yml`.
Tests: `pytest tests/modes tests/telemetry tests/rag`.

**Coordinator RAG hook (opt-in)**: when `swarm-config.json` carries a
top-level `"rag"` block with `"enabled": true`, `POST /api/architect` accepts
`"use_rag": true` (and optional `"rag_top_k": N`). The C++ coordinator embeds
the prompt with the same hash embedder as `matrixctl rag` (see
`cpp_core/src/rag_embed.cpp` — byte-matched against
`orchestration/rag/embed.py:HashEmbedder` via `tests/cpp/rag_embed_test.cpp`),
runs the cosine-distance ANN query against `chunks`, and prepends a
`<context source="rag">…</context>` block to the prompt before mode dispatch.
Hit metadata appears under `meta.rag` in the response. `RAG_DSN` env
overrides the DSN. Only the `hash` embedder is wired into the coordinator;
the MLX/bge path remains Python-only (CLI).

Config shape:
```json
"rag": { "enabled": true, "top_k": 3, "min_score": 1.0, "embedder": "hash" }
```

`min_score` is a **cosine distance ceiling** — a hit is kept when `distance <= min_score` (0 = identical, 1 = orthogonal, 2 = opposite). Recommended values:

| Embedder | Recommended `min_score` | Notes |
|---|---|---|
| `hash` (default) | `1.0` (no filter) | Hash embeddings have no semantic meaning; distances cluster near 1.0. Anything stricter drops every hit. |
| MLX / `bge` / semantic | `~0.6` | True neighbors land at 0.1–0.5, noise at 0.8+. Tighten per-prompt via the UI slider. |

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

Per-mode rosters and presets live in the active config file (the one passed
via `--config`). Set `MATRIX_SOURCE_CONFIG=<path>` in the coordinator's
environment to also mirror to a user-editable source — your edits then
survive a UI redeploy because `proxy_configure` reads `coordinator.modes`
and `coordinator.presets` from source.

## Tests

```bash
bash tests/run.sh                 # full integration suite (~30 tests, ~30s)
bash tests/run.sh -k breaker      # filter by name
bash tests/run.sh -x              # stop on first failure
```

The suite spins up mock agents (Python stdlib HTTP) on isolated ports and
runs the real coordinator binary against them. Covers: every mode's dispatch
shape, streaming SSE event taxonomy, circuit-breaker trip + exclusion,
preset CRUD + apply, retry-on-transient-failure, pipeline skip-with-warning,
runtime prompt editing.

## Documentation

- **[docs/SETUP.md](docs/SETUP.md)** — prerequisites, build steps, model paths, first-run walkthrough, and troubleshooting.
- **[docs/HELP.md](docs/HELP.md)** — quick-reference: UI controls, modes, agent roles, common issues.
- **[docs/USER_MANUAL.md](docs/USER_MANUAL.md)** — end-to-end usage guide: configuring swarms, orchestration modes, conversation threads, presets, RAG, layouts, metrics, resilience, and best practices.
- **[docs/CAPABILITIES.md](docs/CAPABILITIES.md)** — full API reference: every endpoint, SSE event taxonomy, env vars, circuit breaker constants, MLX coordinator, session management, layouts, and RAG internals.
- **In-app help (?)** — quick-start, UI controls, agent roles, and tips without leaving the browser.

## License

See repository.
