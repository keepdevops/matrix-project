# MATRIX SWARM v1.0

A multi-agent LLM system that broadcasts prompts to a configurable swarm of specialized AI roles running in parallel on local hardware. Supports both **llama.cpp** (GGUF) and **MLX** (Apple Silicon native) inference backends.

```
Browser → React UI (3000) → Node Proxy (3002) → C++ Coordinator (8000) → model server instances (8080+)
```

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  React UI  (port 3000 — Docker or bare metal)        │
└──────────────────────┬──────────────────────────────┘
                       │ HTTP
┌──────────────────────▼──────────────────────────────┐
│  Node Proxy  (port 3002)  proxy.mjs                  │
│  • Serves /api/models, /api/swarm-config             │
│  • POST /api/configure → starts model servers        │
│  • Proxies all other requests → coordinator          │
└──────────────────────┬──────────────────────────────┘
                       │ HTTP
┌──────────────────────▼──────────────────────────────┐
│  C++ Coordinator  (port 8000)  coordinator.cpp        │
│  Dispatches to all agents in parallel (std::async)   │
└──┬──────┬──────┬──────┬──────┬───────────────────────┘
   │      │      │      │      │
  8080   8081   8082   8083  8084   ← llama-server or mlx_lm.server instances
```

### Model Server Sharing

Agents that use the same model share a single server instance, reducing memory usage.

- **llama-server (GGUF):** launched with `--parallel N` — agents run truly in parallel within one process
- **mlx_lm.server (MLX):** launched once per model — concurrent requests queue and are processed sequentially

The proxy auto-detects which server to launch: `.gguf` file path → llama-server, directory path → mlx_lm.server.

**Default 5-role layout (4 model instances):**

| Port | Model | Agents | Notes |
|------|-------|--------|-------|
| 8080 | Meta-Llama-3.1-8B | architect + programmer | `--parallel 2` (llama) |
| 8081 | granite-3.1-8b | specialist | `--parallel 1` (llama) |
| 8082 | Llama-3.2-3B | scout | `--parallel 1` (llama) |
| 8083 | gemma-2-2b | synthesis | `--parallel 1` (llama) |

**Example MLX layout (same 5 roles, all MLX):**

| Port | Model | Agents | Notes |
|------|-------|--------|-------|
| 8080 | Meta-Llama-3.1-8B-Instruct-4bit | architect + programmer | queued (mlx) |
| 8081 | Mistral-7B-Instruct-v0.3-4bit | specialist | queued (mlx) |
| 8082 | Llama-3.2-3B-Instruct-4bit | scout | queued (mlx) |
| 8083 | gemma-2-2b-it-4bit | synthesis | queued (mlx) |

Mixed GGUF and MLX agents work in the same swarm — each model gets its own port with the appropriate server.

Port assignments are dynamic — the proxy assigns ports at deploy time based on model grouping.

---

## Prerequisites

- **macOS** (Apple Silicon recommended — Metal GPU acceleration)
- **Node.js** 18+ (`node`, `npm`)
- **C++ compiler** with C++17 support (`clang++` or `g++`)
- **Docker Desktop** (optional — only needed for Docker UI mode)

**llama.cpp backend** (GGUF models):
- `llama-server` binary at `/Users/Shared/llama/llama-server`
- GGUF model files in `/Users/Shared/llama/models/`

**MLX backend** (optional, Apple Silicon only):
- `pip install mlx-lm`
- MLX model directories in `/Users/Shared/llama/models/` (same folder as GGUF files)

See [SETUP_MODELS.md](SETUP_MODELS.md) for llama.cpp build and model download instructions.
See [USER_MANUAL.md](USER_MANUAL.md) for the full user manual with flow diagrams and agent selection guides.

---

## Setup

### 1. Build the coordinator

```bash
bash scripts/build_coordinator.sh
```

### 2. Install UI dependencies

```bash
npm install
```

### 3. Launch

```bash
bash scripts/launch_matrix.sh
```

The launch script asks for mode (Docker or Bare Metal), then starts the Node proxy and React UI.

Access the UI at **http://localhost:3000**

### 4. Deploy your swarm (in the browser)

1. Click **CONFIGURE** in the header
2. Select the inference engine — **LLAMA** (llama.cpp / GGUF) or **MLX** (mlx_lm / Apple Silicon native). Each button shows how many models of that type are available.
3. Select which agents to activate
4. Optionally override the model for any agent using the per-agent dropdown (shows only models of the selected engine)
5. Click **LAUNCH SWARM**

The proxy groups same-model agents onto a shared server instance, waits for all servers to pass `/health` (up to 120 s), then starts the coordinator.

### 5. Shutdown

```bash
bash scripts/shutdown_matrix.sh
```

---

## Agent Roles

| # | Role | Specialty |
|---|------|-----------|
| 1 | **architect** | ASCII UML, system design, component diagrams |
| 2 | **specialist** | C++/Go, performance, memory, concurrency |
| 3 | **scout** | Codebase analysis, patterns, dependencies |
| 4 | **programmer** | Complete production-ready code (large context) |
| 5 | **synthesis** | Execution roadmap, risk analysis, planning |
| 6 | **reviewer** | Bugs, code smells, anti-patterns, best practices |
| 7 | **tester** | Unit tests, integration tests, edge cases |
| 8 | **security** | OWASP risks, vulnerabilities, remediation |
| 9 | **devops** | CI/CD, containers, infrastructure-as-code |
| 10 | **documenter** | API docs, READMEs, inline comments |
| 11 | **optimizer** | Bottlenecks, algorithmic improvements, profiling |
| 12 | **debugger** | Root cause analysis, error propagation, fixes |
| 13 | **database** | Schemas, queries, indexing, caching |
| 14 | **frontend** | React, CSS, accessibility, UX |
| 15 | **api** | REST/GraphQL design, OpenAPI, versioning |

---

## UI Controls

| Control | Description |
|---------|-------------|
| **ONLINE / OFFLINE** | Coordinator status. OFFLINE means the backend is unreachable — open CONFIGURE to deploy a swarm. |
| **CONFIGURE** | Opens the swarm config panel. Choose engine (LLAMA / MLX), select agents, assign models, click LAUNCH SWARM. |
| **CLEAR KV** | Erases the KV cache on all llama-server agents. Has no effect on MLX agents (MLX manages its own context). |
| **HISTORY (N)** | Shows your last 10 prompts. Click any entry to reload it into the prompt box. |
| **?** | Opens the in-app help modal. |
| **Temperature** | `0.1` = focused/deterministic. `1.0` = creative/varied. |
| **BROADCAST / Cmd+Enter** | Dispatches the prompt to all active agents in parallel. |

The **CODE OUTPUT** panel below the agent grid auto-extracts code blocks from the `programmer` agent response into a syntax-highlighted CodeMirror editor.

---

## Scripts

### Shell scripts

| Script | Purpose |
|--------|---------|
| `scripts/launch_matrix.sh` | Start the proxy and UI (Docker or bare metal mode) |
| `scripts/shutdown_matrix.sh` | Clean shutdown — stops all processes and frees ports |
| `scripts/build_coordinator.sh` | Recompile `coordinator.cpp` → `./coordinator` |

### npm shortcuts

```bash
npm start              # React dev server (port 3000)
npm run build          # Production build
npm run proxy          # Start Node proxy only (port 3002)
npm run launch         # Same as bash scripts/launch_matrix.sh
npm run shutdown       # Same as bash scripts/shutdown_matrix.sh
npm run build:coordinator  # Same as bash scripts/build_coordinator.sh
```

---

## Configuration

**`swarm-config.json`** — Defines all 15 roles with default model path, context size, GPU layers, timeouts, and system prompts. Never modified at runtime — used as the template when building the active config.

**`/tmp/matrix-active-config.json`** — Written by the proxy on every LAUNCH SWARM. Contains the selected agents with resolved model paths and assigned ports. Read by the coordinator at startup.

**`history.json`** — Append-only session history written by the coordinator after each broadcast. Read by the UI's HISTORY panel (last 10 entries).

**`proxy.mjs`** — Owns three direct endpoints (`/api/models`, `/api/swarm-config`, `/api/configure`) and proxies everything else to the coordinator at port 8000. The `/api/configure` handler spawns model servers, waits for health, then starts the coordinator.

**`mlx_models.json`** — Reference registry of known GGUF and MLX models with HuggingFace repo IDs. Not used at runtime — informational only.

### Key paths

| Path | Purpose |
|------|---------|
| `/Users/Shared/llama/llama-server` | llama.cpp server binary |
| `/Users/Shared/llama/models/` | GGUF (`.gguf` files) and MLX (directories with `config.json`) models |
| `/tmp/matrix-active-config.json` | Active session config — written at deploy time, read by coordinator |
| `/tmp/matrix-slots/` | llama-server KV slot save path (GGUF only) |
| `history.json` | Prompt + response history, appended by coordinator after each broadcast |
| `logs/` | Runtime logs — `proxy.log`, `coordinator.log`, `<port>.log` per model server |

### Key ports

| Port | Service |
|------|---------|
| 3000 | React UI |
| 3002 | Node proxy |
| 8000 | C++ coordinator |
| 8080+ | Model server instances — one per unique model, assigned dynamically (llama-server or mlx_lm.server) |

---

## Project Structure

```
matrix-project/
├── README.md                # Project overview and reference
├── USER_MANUAL.md           # Full user manual with flow diagrams
├── SETUP_MODELS.md          # llama.cpp build and model download guide
├── coordinator.cpp          # C++ multi-agent dispatcher
├── coordinator              # Compiled binary (after build)
├── proxy.mjs                # Node.js proxy + deploy logic
├── swarm-config.json        # All 15 agent role definitions
├── mlx_models.json          # Model registry (GGUF + MLX)
├── docker-compose.yml       # UI container (React only)
├── Dockerfile.web           # React UI image
├── pixi.toml                # Pixi environment (Node 18+, Python 3.10+, C++17)
├── scripts/
│   ├── launch_matrix.sh     # Start proxy + UI
│   ├── shutdown_matrix.sh   # Shutdown all services
│   └── build_coordinator.sh # Compile coordinator.cpp
├── logs/                    # Runtime logs (created automatically)
├── history.json             # Prompt + response history (written by coordinator)
└── src/
    ├── App.js               # Root React component (header, grid, help modal)
    ├── App.css              # Dark matrix theme styles
    ├── api/swarmApi.js      # API client (submit, history, agents, models, etc.)
    ├── hooks/useSwarm.js    # Swarm state hook
    ├── components/
    │   ├── PromptInput.js   # Prompt textarea + temperature slider
    │   ├── AgentResponse.js # Individual agent response card
    │   ├── CodeDisplay.js   # CodeMirror syntax-highlighted code panel
    │   └── SwarmConfig.js   # Agent selector + model picker + LAUNCH SWARM
    └── utils/codeExtractor.js  # Extract code blocks from agent responses
```
