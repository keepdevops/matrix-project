# Matrix Swarm

A multi-agent local-LLM workbench. Broadcasts a single prompt to many specialised
agents (architect, programmer, security, reviewer, …) running in parallel against
local inference servers (llama.cpp, MLX, vLLM), then collects, displays, and
extracts code from their responses in a React UI.

```
┌──────────┐    ┌──────────┐    ┌─────────────────────────┐
│ React UI │───▶│  proxy   │───▶│  coordinator (C++)      │
│  :3000   │    │  :3002   │    │  :8000                  │
└──────────┘    └──────────┘    │  ├─ flat / pipeline /   │
                                │  │  router modes        │
                                │  └─▶ N agent backends   │
                                │      (llama / mlx / vllm)│
                                └─────────────────────────┘
```

## Features

- **16+ specialised agent roles** — architect, foreman, programmer, specialist,
  security, api, database, frontend, reviewer, tester, optimizer, debugger,
  devops, scout, synthesis, documenter. Each has a tuned system prompt and a
  colour in the UI.
- **Three orchestration modes** (selectable from the UI MODE menu):
  - `flat` — broadcast the prompt to every agent in parallel; no reducer.
  - `pipeline` — sequential chain; each agent receives the previous agent's output.
  - `router` — a classifier agent picks a subset; prompt is sent to those agents only.
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

- **MODE: FLAT/PIPELINE/ROUTER** — orchestration strategy (see Features).
- **CONFIGURE** — choose engine, agents, and per-agent models, then LAUNCH SWARM.
- **CLEAR KV** — wipe agent state between unrelated prompts.
- **HISTORY (N)** — recall any of the last 10 broadcasts and their responses.
- **Temperature** — default `0.20`. Stay in `0.10–0.25` for code; `0.40–0.70`
  only for open-ended brainstorming.
- **BROADCAST / Cmd+Enter** — send the prompt under the active mode.
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

## License

See repository.
