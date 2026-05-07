# Matrix Swarm

[![npm version](https://img.shields.io/npm/v/@keepdevops/matrix?style=flat-square&logo=npm&color=00ccff)](https://www.npmjs.com/package/@keepdevops/matrix)
[![npm downloads](https://img.shields.io/npm/dm/@keepdevops/matrix?style=flat-square&color=8a8a99&label=downloads)](https://www.npmjs.com/package/@keepdevops/matrix)
[![GitHub stars](https://img.shields.io/github/stars/keepdevops/matrix-project?style=flat-square&logo=github&color=00ff9d)](https://github.com/keepdevops/matrix-project)
[![License](https://img.shields.io/github/license/keepdevops/matrix-project?style=flat-square&color=8a8a99&v=2)](LICENSE)

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
| Open source | **Yes** | No | Yes | Yes |

### vs. MCP / agent frameworks

| | Matrix Swarm | CrewAI | LangGraph | AutoGen | OpenDevin | MetaGPT |
|---|---|---|---|---|---|---|
| Core focus | **Local coding / DevOps swarm** | Role-based crews | Stateful graph workflows | Conversational multi-agent | Autonomous coding agent | Software-company sim |
| Local-first / air-gapped | **Yes (default)** | Optional | Optional | Optional | Strong | Optional |
| Backends | **MLX + llama.cpp + vLLM mixable per agent** | Any | LangChain ecosystem | Multiple + local | Ollama / local | Any |
| Pre-built agents | **16+ specialised** | User-defined | Graph nodes | Dynamic | Single + tools | Fixed dev team |
| Orchestration | **Flat · Pipeline · Cascade · Router** | Sequential / hierarchical | Graph (loops, branches) | Message-based | Tool-loop | Pipeline |
| UI | **Real-time React + code editor** | CLI | Visualisation tools | AutoGen Studio | VS Code-like | CLI |
| Hardware tuning | **Apple Silicon + CUDA presets** | Neutral | Neutral | Neutral | Good | Neutral |
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
                                │  └─▶ N agent backends   │
                                │      (llama / mlx / vllm)│
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
    typically faster per-token on M-series.
  - **vLLM** — 4 servers via Docker Model Runner on ports 8080–8083
    (Qwen2.5-14B, Llama-3.2-3B, DeepSeek-Coder-V2, Phi-4-mini).
- **Per-agent model override** — point any agent at any model file/dir from the
  CONFIGURE panel.
- **CodeMirror response viewer** — auto-language-detect, edit, copy, save. Each
  card has an expand (⤢) button for a full-screen editor.
- **Auto code extraction** — the `programmer` agent's first code block is pulled
  into a syntax-highlighted CODE OUTPUT pane below the grid (C++, Go, Python,
  JS, Rust, SQL, …).
- **Broadcast history** — last 10 prompts and full responses, click to reload.
- **CLEAR KV** — drop llama-server KV cache and restart MLX servers between
  unrelated prompts.
- **SAVE CODE** — export every agent's code blocks to one timestamped file.
- **Pre-built swarm configs** — `swarm-config.json`,
  `swarm-config-16gb.json`, `swarm-config-32gb.json`,
  `swarm-config-8agents-text-image.json`.
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
- **Integration test suite** — `bash tests/run.sh` runs ~30 end-to-end tests
  against a coordinator wired to mock agents (no real models needed). Covers
  every mode, streaming, breaker, presets, retry/skip, prompt editing.

## Requirements

- macOS (Apple Silicon recommended for MLX).
- Node ≥ 18 < 23, npm ≥ 9.
- C++17 toolchain (clang) for building `coordinator` and `proxy`.
- For LLAMA: `llama-server` from llama.cpp on `PATH`.
- For MLX: `pip install mlx-lm` (Apple Silicon).
- For vLLM: Docker Desktop with Model Runner.
- GGUF / MLX models on disk. Default config expects models under
  `/Users/Shared/llama/models/` (override per-agent in the UI).

## Quick start

```bash
# 1. Build the C++ binaries (coordinator + proxy)
bash scripts/build_cpp_binaries.sh

# 2. (optional) load env defaults
source scripts/matrix-env.sh

# 3. Pre-flight check (ports, binaries, models)
bash scripts/matrix-1-check.sh

# 4. Launch — starts proxy (:3002) and React UI (:3000)
bash scripts/matrix-2-launch.sh

# 5. Open http://localhost:3000
#    → CONFIGURE → choose engine + agents → LAUNCH SWARM
#    → wait for ONLINE → type prompt → BROADCAST (Cmd+Enter)

# 6. Stop everything
bash scripts/matrix-3-shutdown.sh
```

The coordinator listens on `:8000` once **LAUNCH SWARM** has been clicked in
the UI. The proxy on `:3002` fronts both the coordinator API and the
inference servers.

## NPM scripts

| Script | What it does |
|---|---|
| `npm start` | React dev server on `:3000` |
| `npm run proxy` | Node proxy on `:3002` |
| `npm run launch` | `bash scripts/launch_matrix.sh` (legacy alias) |
| `npm run shutdown` | `bash scripts/shutdown_matrix.sh` |
| `npm run build:coordinator` | Build the C++ coordinator |
| `npm test` | Run the smoke test once |

## UI cheat sheet

- **MODE: FLAT/PIPELINE/CASCADE/ROUTER** — orchestration strategy (see Features).
- **CONFIGURE** — choose engine, agents, per-agent models, edit any agent's
  system prompt (✏️), then LAUNCH SWARM.
- **PER-MODE ROSTER** (inside CONFIGURE) — pick which agents participate in
  each mode. Synthesizer dropdown for pipeline + cascade. `max_select` slider
  for router. Save active state as a named **PRESET**, apply later in one click.
- **CLEAR KV** — wipe agent state between unrelated prompts.
- **HISTORY (N)** — recall any of the last 10 broadcasts and their responses.
- **Temperature** — default `0.20`. Stay in `0.10–0.25` for code; `0.40–0.70`
  only for open-ended brainstorming.
- **BROADCAST / Cmd+Enter** — send the prompt under the active mode.
- **RUN METRICS** — per-agent ms + token bars below FINAL ANSWER after every
  dispatch.
- **🔴 circuit breaker open** banner appears in PER-MODE ROSTER when any
  agent has tripped; cooldown counts down in seconds.
- **⤢ on a card** — open that agent's full response in a CodeMirror editor.
- **SAVE CODE** — dump all extracted code to a timestamped file.
- **?** — in-app help modal with the same content as this section.

## Tips

- 5–7 agents is the sweet spot for coding swarms; 12–16 agents risks VRAM /
  KV-token exhaustion.
- CLEAR KV before every new major prompt — first prompt fills KV with context;
  a second prompt without clearing can leave half the agents reading
  contradictory instructions.
- On Apple Silicon, mix standard LLAMA agents with `mlx-coder` to compare
  Metal-optimised inference against llama.cpp on the same broadcast.
- Use `pipeline` mode for "architect → programmer → reviewer" style chains and
  `router` mode when only a subset of agents is relevant per prompt.

## Repository layout

```
src/                React UI (App, components, hooks, api)
src2/               C++ coordinator + proxy + modes (flat/pipeline/router)
scripts/            Build / launch / shutdown / env helpers
public/             CRA static assets, models.json fallback
swarm-config*.json  Pre-tuned agent/model layouts
docker/             Optional Docker bits (not required for bare-metal run)
production/         Optional nginx UI (not required for dev)
```

## Coordinator HTTP API (cheat sheet)

| Method · Path | Purpose |
|---|---|
| `GET  /api/health` | Liveness check. |
| `GET  /api/agents` | Active agent list. |
| `GET  /api/modes` · `GET /api/modes/active` | List modes / read active. |
| `POST /api/modes/active {mode}` | Switch active mode. |
| `GET  /api/modes/<name>/agents` | Per-mode roster + synthesizer + max_select. |
| `PUT  /api/modes/<name>/agents {agents, synthesizer?, max_select?}` | Edit roster. |
| `GET  /api/presets` · `PUT /api/presets/<name>` · `DELETE /api/presets/<name>` · `POST /api/presets/<name>/apply` | CRUD + apply for named bundles. |
| `PUT  /api/agents/<name>/prompt {system_prompt}` | Edit any agent's system prompt; clears response cache; persists. |
| `GET  /api/health/agents` | Per-agent circuit-breaker snapshot. |
| `GET  /api/pressure` | Per-port KV / queue pressure. |
| `POST /api/architect {prompt, temperature?}` | Dispatch under active mode → envelope `{mode, agents, final, meta}`. |
| `POST /api/architect/stream {prompt}` | Same dispatch as SSE. Events: `token`, `agent_done`, `stage` (pipeline), `selected` (router), `synthesis_start` (cascade/pipeline), `metrics`, `done`. |
| `POST /api/clear-cache` | Clear all KV slots. |

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

- **[docs/CAPABILITIES.md](docs/CAPABILITIES.md)** — full reference for
  modes, presets, prompt editing, streaming SSE, circuit breaker, retry
  semantics, metrics envelope, persistence model, every HTTP endpoint, and
  every env var.
- **In-app help (?)** — same content as this README plus a streaming SSE
  cheat sheet.

## License

See repository.
