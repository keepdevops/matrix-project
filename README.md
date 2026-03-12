# MATRIX SWARM v1.0

A multi-agent LLM system that broadcasts prompts to a configurable swarm of specialized AI roles running in parallel on local hardware via llama.cpp.

```
Browser → React UI (3000) → Node Proxy (3002) → C++ Coordinator (8000) → llama-server instances (8080+)
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
│  • POST /api/configure → starts llama-servers        │
│  • Proxies all other requests → coordinator          │
└──────────────────────┬──────────────────────────────┘
                       │ HTTP
┌──────────────────────▼──────────────────────────────┐
│  C++ Coordinator  (port 8000)  coordinator.cpp        │
│  Dispatches to all agents in parallel (std::async)   │
└──┬──────┬──────┬──────┬──────┬───────────────────────┘
   │      │      │      │      │
  8080   8081   8082   8083  8084   ← llama-server instances
```

### VRAM Sharing

Agents that use the same model share a single `llama-server` instance launched with `--parallel N`, dramatically reducing VRAM usage.

**Default 5-role layout (4 model instances):**

| Port | Model | Agents | --parallel |
|------|-------|--------|------------|
| 8080 | Meta-Llama-3.1-8B | architect + programmer | 2 |
| 8081 | granite-3.1-8b | specialist | 1 |
| 8082 | Llama-3.2-3B | scout | 1 |
| 8083 | gemma-2-2b | synthesis | 1 |

**Full 15-role layout (4 model instances):**

| Port | Model | Agents | --parallel |
|------|-------|--------|------------|
| 8080 | Meta-Llama-3.1-8B | architect, programmer, debugger | 3 |
| 8081 | granite-3.1-8b | specialist, security, optimizer | 3 |
| 8082 | Llama-3.2-3B | scout, reviewer, tester, devops, database, api | 6 |
| 8083 | gemma-2-2b | synthesis, documenter, frontend | 3 |

Port assignments are dynamic — the proxy assigns ports at deploy time based on model grouping.

---

## Prerequisites

- **macOS** (Apple Silicon recommended — Metal GPU acceleration)
- **llama-server binary** at `/Users/Shared/llama/llama-server`
- **GGUF model files** in `/Users/Shared/llama/models/`
- **Node.js** 18+ (`node`, `npm`)
- **C++ compiler** with C++17 support (`clang++` or `g++`)
- **Docker Desktop** (optional — only needed for Docker UI mode)

See [SETUP_MODELS.md](SETUP_MODELS.md) for llama.cpp build and model download instructions.

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
2. Select which agents to activate
3. Optionally override the model for each agent (any `.gguf` from `/Users/Shared/llama/models/`)
4. Click **LAUNCH SWARM**

The proxy groups same-model agents onto shared `llama-server` instances, waits for all servers to pass `/health` (up to 120 s), then starts the coordinator.

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
| **CONFIGURE** | Opens the swarm config panel. Select agents, assign models, click LAUNCH SWARM. |
| **CLEAR KV** | Erases the KV cache on all agent servers. Useful when agents seem stuck or after switching tasks. |
| **HISTORY (N)** | Shows your last 10 prompts. Click any entry to reload it into the prompt box. |
| **?** | Opens the in-app help modal. |
| **Temperature** | `0.1` = focused/deterministic. `1.0` = creative/varied. |
| **BROADCAST / Cmd+Enter** | Dispatches the prompt to all active agents in parallel. |

The **CODE OUTPUT** panel below the agent grid auto-extracts code blocks from the `programmer` agent response into a syntax-highlighted CodeMirror editor.

---

## Scripts

| Script | Purpose |
|--------|---------|
| `scripts/launch_matrix.sh` | Start the proxy and UI (Docker or bare metal mode) |
| `scripts/shutdown_matrix.sh` | Clean shutdown — stops all processes and frees ports |
| `scripts/build_coordinator.sh` | Recompile `coordinator.cpp` → `./coordinator` |

---

## Configuration

**`swarm-config.json`** — Defines all 15 roles with default model path, context size, GPU layers, timeouts, and system prompts. This file is the source of truth; it is never modified at runtime.

When you click **LAUNCH SWARM**, the proxy writes the selected agents (with any model overrides) to `/tmp/matrix-active-config.json`. Both the coordinator and proxy use this file for the session.

**`proxy.mjs`** — Forwards `/api/*` requests from the React UI (port 3002) to the coordinator (port 8000). Also owns the `/api/models`, `/api/swarm-config`, and `/api/configure` endpoints directly.

### Key paths

| Path | Purpose |
|------|---------|
| `/Users/Shared/llama/llama-server` | llama.cpp server binary |
| `/Users/Shared/llama/models/` | GGUF model files |
| `/tmp/matrix-active-config.json` | Active session config (written at deploy time) |
| `/tmp/matrix-slots/` | llama-server KV slot save path |
| `logs/` | Runtime logs (proxy, coordinator, per-port llama-server) |

### Key ports

| Port | Service |
|------|---------|
| 3000 | React UI |
| 3002 | Node proxy |
| 8000 | C++ coordinator |
| 8080+ | llama-server instances (one per unique model, assigned dynamically) |

---

## Project Structure

```
matrix-project/
├── coordinator.cpp          # C++ multi-agent dispatcher
├── coordinator              # Compiled binary (after build)
├── proxy.mjs                # Node.js proxy + deploy logic
├── swarm-config.json        # All 15 agent role definitions
├── mlx_models.json          # GGUF model registry
├── docker-compose.yml       # UI container (React only)
├── Dockerfile.web           # React UI image
├── pixi.toml                # Pixi environment (Node 18+, Python 3.10+, C++17)
├── scripts/
│   ├── launch_matrix.sh     # Start proxy + UI
│   ├── shutdown_matrix.sh   # Shutdown all services
│   └── build_coordinator.sh # Compile coordinator.cpp
├── logs/                    # Runtime logs (created automatically)
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
