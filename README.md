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
| 8080 | Llama-3.2-3B | scout | 1 |
| 8081 | Granite-3.1-8B | specialist | 1 |
| 8082 | Gemma-2-2B | synthesis | 1 |
| 8083 | Meta-Llama-3.1-8B | architect + programmer | 2 |

**Full 15-role layout (5 model instances):**

| Port | Model | Agents | --parallel |
|------|-------|--------|------------|
| 8080 | Llama-3.2-3B | scout, reviewer, tester, devops, database, api | 6 |
| 8081 | Granite-3.1-8B | specialist, security, optimizer | 3 |
| 8082 | Gemma-2-2B | synthesis, documenter, frontend | 3 |
| 8083 | Meta-Llama-3.1-8B | architect, programmer | 2 |
| 8084 | Meta-Llama-3.1-8B | debugger | 1 |

---

## Prerequisites

- **macOS** (Apple Silicon recommended — Metal GPU acceleration)
- **llama.cpp** binary at `/Users/Shared/models/llama-server`
- **GGUF model files** in `/Users/Shared/models/`
- **Node.js** 18+ (`node`, `npm`)
- **Python 3** (stdlib only — no pip installs needed)
- **C++ compiler** with C++17 support (`clang++` or `g++`)
- **Docker Desktop** (optional — only needed for Docker UI mode)

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

The launch script prompts for:

1. **Mode** — Docker (UI in container) or Bare Metal (`npm start`)
2. **Roles** — Pick any of the 15 agents by number (e.g. `1 4 8`), or press Enter for the default 5
3. **Models** — For each selected role, keep the default or pick another from `/Users/Shared/models/`

The script then cleans up existing processes, starts one `llama-server` per unique model with `--parallel N`, waits for all servers to pass `/health`, and starts the coordinator, proxy, and UI.

Access the UI at **http://localhost:3000**

### 4. Shutdown

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

## Scripts

| Script | Purpose |
|--------|---------|
| `scripts/launch_matrix.sh` | Main launch — interactive role + model picker, starts all services |
| `scripts/shutdown_matrix.sh` | Clean shutdown — stops all processes, frees ports |
| `scripts/build_coordinator.sh` | Recompiles `coordinator.cpp` → `./coordinator` |

---

## Configuration

**`swarm-config.json`** — Defines all 15 roles with default model, context size, GPU layers, timeouts, and system prompts. Never modified at runtime.

At launch the selected agents (with any model overrides) are written to `/tmp/matrix-active-config.json`. Both the coordinator and launch script use this file for the session.

**`proxy.mjs`** — Forwards all `/api/*` requests from port 3002 to the coordinator at port 8000.

### Key ports

| Port | Service |
|------|---------|
| 3000 | React UI |
| 3002 | Node proxy |
| 8000 | C++ coordinator |
| 8080+ | llama-server instances (one per unique model) |

---

## Project Structure

```
matrix-project/
├── coordinator.cpp          # C++ multi-agent dispatcher
├── coordinator              # Compiled binary (after build)
├── proxy.mjs                # Node.js API proxy
├── swarm-config.json        # Agent definitions (all 15 roles)
├── docker-compose.yml       # UI container (React only)
├── Dockerfile.web           # React UI image
├── scripts/
│   ├── launch_matrix.sh     # Main launch script
│   ├── shutdown_matrix.sh   # Shutdown script
│   └── build_coordinator.sh # C++ build script
└── src/
    ├── App.js               # Root React component
    ├── api/swarmApi.js      # API client
    ├── hooks/useSwarm.js    # Swarm state hook
    ├── components/
    │   ├── PromptInput.js   # Prompt + temperature input
    │   ├── AgentResponse.js # Individual agent card
    │   └── CodeDisplay.js   # Syntax-highlighted code panel
    └── utils/codeExtractor.js
```
