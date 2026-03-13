# MATRIX SWARM — User Manual

## Table of Contents

1. [What is Matrix Swarm?](#1-what-is-matrix-swarm)
2. [System Requirements](#2-system-requirements)
3. [First Launch](#3-first-launch)
4. [The Configure Panel](#4-the-configure-panel)
5. [Broadcasting a Prompt](#5-broadcasting-a-prompt)
6. [Reading Results](#6-reading-results)
7. [Choosing Agents for Your Task](#7-choosing-agents-for-your-task)
8. [Choosing an Inference Engine](#8-choosing-an-inference-engine)
9. [Temperature Guide](#9-temperature-guide)
10. [History](#10-history)
11. [KV Cache](#11-kv-cache)
12. [How the Coordinator Works](#12-how-the-coordinator-works)
13. [Troubleshooting](#13-troubleshooting)

---

## 1. What is Matrix Swarm?

Matrix Swarm sends one prompt to a group of specialized AI agents simultaneously. Each agent has a distinct role and system prompt — architect, programmer, security auditor, etc. — and responds in parallel. You get a multi-perspective analysis of your question in roughly the same time it takes to query a single model.

```
You type one prompt
        │
        ▼
┌───────────────────────────────────────────────────┐
│               C++ Coordinator                     │
│         broadcasts to all agents at once          │
└──┬───────┬───────┬───────┬───────┬────────────────┘
   │       │       │       │       │
   ▼       ▼       ▼       ▼       ▼
architect  programmer  reviewer  security  synthesis
   │       │       │       │       │
   ▼       ▼       ▼       ▼       ▼
 design   code   bugs  vulns   plan
   │       │       │       │       │
   └───────┴───────┴───────┴───────┘
                   │
                   ▼
        All cards update in the UI
        Code → CODE OUTPUT panel
```

---

## 2. System Requirements

| Requirement | Detail |
|-------------|--------|
| OS | macOS (Apple Silicon M1/M2/M3 recommended) |
| Node.js | 18 or later |
| C++ compiler | Clang++ or g++ with C++17 |
| llama-server | Built from llama.cpp at `/Users/Shared/llama/llama-server` (for LLAMA engine) |
| GGUF models | In `/Users/Shared/llama/models/` (for LLAMA engine) |
| mlx-lm | `pip install mlx-lm` (for MLX engine, optional) |
| MLX models | Directories in `/Users/Shared/llama/models/` (for MLX engine) |
| Docker Desktop | Optional — only needed for Docker UI mode |
| Free RAM | ~6 GB for the default 5-agent GGUF swarm; varies by model selection |

See [SETUP_MODELS.md](SETUP_MODELS.md) for model download instructions.

---

## 3. First Launch

### Build and install (once)

```bash
# 1. Compile the C++ coordinator
bash scripts/build_coordinator.sh

# 2. Install JavaScript dependencies
npm install
```

### Launch flow

```
bash scripts/launch_matrix.sh
        │
        ▼
  ┌─────────────────────────┐
  │ Select mode:            │
  │  1) Docker              │
  │  2) Bare Metal          │
  └────────────┬────────────┘
               │
       ┌───────┴───────┐
       │               │
       ▼               ▼
   Docker           Bare Metal
docker-compose     npm start
   up -d         (port 3000)
       │               │
       └───────┬───────┘
               │
               ▼
    node proxy.mjs starts
       (port 3002)
               │
               ▼
   Open http://localhost:3000
               │
               ▼
       ┌───────────────┐
       │  OFFLINE (red)│  ← coordinator not yet running
       └───────┬───────┘
               │
               ▼
     Click CONFIGURE  ──────────────────────────────────►
     (deploy your swarm — see Section 4)
               │
               ▼
       ┌───────────────┐
       │  ONLINE (blue)│  ← ready to broadcast
       └───────────────┘
```

The UI checks coordinator status every 10 seconds and updates automatically once a swarm is deployed.

---

## 4. The Configure Panel

Click **CONFIGURE** in the header to open the panel. It has two columns: agent selection (left) and server layout preview (right).

### Configuration flow

```
  ┌─────────────────────────────────────────────────────────┐
  │                   CONFIGURE PANEL                       │
  │                                                         │
  │  ENGINE ──► [ LLAMA ] [ MLX ]                         │
  │               ↑          ↑ count of models            │
  │                                                         │
  │  SELECT AGENTS              SERVER LAYOUT               │
  │  ☑ architect ▾ Meta-Llama   :8080  ×2  [architect,      │
  │  ☑ specialist ▾ granite              programmer]        │
  │  ☑ scout ▾ Llama-3.2        :8081  ×1  [specialist]     │
  │  ☑ programmer ▾ Meta-Llama  :8082  ×1  [scout]          │
  │  ☑ synthesis ▾ gemma-2      :8083  ×1  [synthesis]      │
  │  ☐ reviewer                                             │
  │  ☐ tester                              [LAUNCH SWARM]   │
  │  ...                                                    │
  └─────────────────────────────────────────────────────────┘
```

### Step-by-step

**1. Choose engine**
- **LLAMA** — C++ `llama-server` (llama.cpp). Loads `.gguf` files; same-model agents share one process with `--parallel N` for true parallelism. CLEAR KV works.
- **MLX** — `mlx_lm.server` (Apple Silicon). Loads model directories. Often faster per-token on M-series; requests queue per server.
- The number in parentheses shows how many models of that type are installed. A greyed-out button means none found.

**2. Select agents**
Check or uncheck agents. Each selected agent shows a model dropdown filtered to the chosen engine. You can assign a different model to each agent — agents that share the same model are automatically grouped onto one server instance.

**3. Read the server layout**
The right column shows which servers will be started:
- `:8080 ×2` — one llama-server on port 8080 with `--parallel 2`
- `:8082 [mlx]` — one mlx_lm.server on port 8082

**4. Click LAUNCH SWARM**

What happens next:
```
  Proxy stops any running model servers
          │
          ▼
  Proxy starts one server per unique model
  (llama-server or mlx_lm.server)
          │
          ▼
  Proxy polls GET /health on each port
  every 2 s, timeout 120 s
          │
          ▼
  All servers healthy?
     │           │
    YES          NO
     │           │
     ▼           ▼
  Proxy starts   Returns error
  coordinator    "failed to become
  (port 8000)    healthy within 120s"
     │
     ▼
  UI polls /api/health every 2 s
     │
     ▼
  Status → ONLINE (blue)
```

---

## 5. Broadcasting a Prompt

```
  ┌────────────────────────────────────────────────────┐
  │  ┌──────────────────────────────────────────────┐  │
  │  │  Describe your task or question here...      │  │
  │  └──────────────────────────────────────────────┘  │
  │                                                    │
  │  TEMP  0.1 ──────────●──────────────────── 1.0    │
  │              focused              creative         │
  │                                                    │
  │                              [ BROADCAST ]         │
  └────────────────────────────────────────────────────┘
```

- Type your prompt in the text box
- Adjust temperature (see [Section 9](#9-temperature-guide))
- Click **BROADCAST** or press **Cmd+Enter**

### What happens during a broadcast

```
  React UI
  POST /api/architect  {"prompt": "...", "temperature": 0.7}
          │
          ▼
  Node Proxy (port 3002)
  forwards to Coordinator
          │
          ▼
  C++ Coordinator (port 8000)
  launches std::async futures for all agents
          │
    ┌─────┼─────┬─────┬─────┐
    ▼     ▼     ▼     ▼     ▼
  POST /v1/chat/completions  (each agent's llama-server or mlx_lm.server)
    │     │     │     │     │
    ▼     ▼     ▼     ▼     ▼
  responses collected (blocking until all complete)
          │
          ▼
  Entry appended to history.json
          │
          ▼
  JSON response returned to UI
          │
          ▼
  Agent cards update with responses
  Programmer code → CODE OUTPUT panel
```

Agents run in parallel — the slowest agent determines total response time. The `programmer` agent has a 300 s timeout and up to 4096 output tokens; all others cap at 1024 tokens and 60 s.

---

## 6. Reading Results

### Agent cards

```
  ┌─────────────────────────────┐
  │ ■ ARCHITECT        :8080    │  ← colour-coded name + port
  │──────────────────────────── │
  │ ┌──────────────────────┐   │
  │ │  System Overview     │   │  ← scrollable response
  │ │                      │   │
  │ │  ┌────────────────┐  │   │
  │ │  │  Component A   │  │   │
  │ │  └───────┬────────┘  │   │
  │ │          │           │   │
  │ └──────────────────────┘   │
  └─────────────────────────────┘
```

Each card is independently scrollable. A gold spinning indicator means that agent is still waiting for a response.

### CODE OUTPUT panel

When the **programmer** agent's response contains a code block, it is automatically extracted and displayed in a syntax-highlighted editor below the agent grid.

```
  ┌─── CODE OUTPUT ──────────────────────────────────────┐
  │  python          [ COPY ]  [ WRAP ]                  │
  │──────────────────────────────────────────────────────│
  │  def authenticate(token: str) -> bool:               │
  │      payload = jwt.decode(token, SECRET_KEY, ...)    │
  │      return payload.get("valid", False)              │
  └──────────────────────────────────────────────────────┘
```

Supported languages: Python, JavaScript, TypeScript, C++, Go, Rust, Java, PHP, SQL, HTML, CSS, Markdown, JSON, XML.

### How to read agents together

| Agent | Answers |
|-------|---------|
| architect | How should this be structured? |
| programmer | What does the code look like? |
| reviewer | What's wrong with this approach? |
| security | What are the attack vectors? |
| tester | How do we verify it works? |
| synthesis | What order should we tackle this? |
| devops | How do we ship and run this? |

---

## 7. Choosing Agents for Your Task

### New feature development

```
Recommended: architect + programmer + tester + security + devops

architect  ──► overall design and component structure
programmer ──► full implementation with imports and error handling
tester     ──► unit and integration test suite
security   ──► vulnerabilities and secure patterns
devops     ──► CI/CD pipeline and containerisation
```

### Code review / audit

```
Recommended: reviewer + security + optimizer + tester

reviewer   ──► code smells, anti-patterns, style issues
security   ──► OWASP risks and remediation steps
optimizer  ──► performance bottlenecks and algorithmic improvements
tester     ──► missing test coverage and edge cases
```

### Debugging a problem

```
Recommended: debugger + reviewer + tester

debugger   ──► root cause analysis and targeted fix
reviewer   ──► broader code quality issues around the bug
tester     ──► regression tests to prevent recurrence
```

### Architecture / system design

```
Recommended: architect + specialist + synthesis + database + api

architect  ──► system diagrams and component relationships
specialist ──► performance and low-level implementation concerns
synthesis  ──► prioritised roadmap and risk assessment
database   ──► data model and query design
api        ──► API contract, versioning, and OpenAPI spec
```

### Documentation pass

```
Recommended: documenter + api + architect

documenter ──► README, inline comments, user guides
api        ──► OpenAPI spec and endpoint documentation
architect  ──► system overview diagrams
```

### Minimum viable swarm (fastest)

```
architect + programmer + synthesis  (3 agents, 2–3 model instances)

Good for: quick exploration, prototyping, one-off questions
```

---

## 8. Choosing an Inference Engine

```
                    ┌─────────────────────────────────────────┐
                    │          Which engine?                  │
                    └──────────────┬──────────────────────────┘
                                   │
              ┌────────────────────┼────────────────────┬────────────────────┐
              │                    │                    │                    │
              ▼                    ▼                    ▼                    │
         LLAMA (C++)                            MLX (Apple Silicon)       │
              │                                        │                    │
    ┌─────────────────┐                      ┌─────────────────────┐     │
    │ .gguf            │                      │ model directory     │     │
    │ llama-server     │                      │ mlx_lm.server       │     │
    │ --parallel N     │                      │ queued requests     │     │
    └────────┬─────────┘                      └──────────┬──────────┘     │
             │                                        │                  │
             ▼                                        ▼                  │
    Best when:                                Best when:                │
    • Many agents                             • Speed per token         │
      same model                              • mlx-community           │
    • CLEAR KV                                • Fewer agents            │
```

**In practice:** **LLAMA** gives true parallelism (many agents, same model) and CLEAR KV. **MLX** is often fastest per-token on Apple Silicon. Mixed swarms work — you can assign different engines to different agents.

### MLX (mlx-lm) setup and help

MLX runs models natively on Apple Silicon (M1/M2/M3) using Metal. The Matrix proxy starts `mlx_lm.server` (from the **mlx-lm** Python package) for each unique MLX model you assign in CONFIGURE.

| Step | What to do |
|------|------------|
| **Install mlx-lm** | `pip install mlx-lm` (or install inside your pixi/conda env if you use `scripts/run_matrix_pixi.sh`) |
| **Model location** | MLX models must be **directories** under `/Users/Shared/llama/models/` (same parent as GGUF files). |
| **Model format** | Each directory must contain `config.json`, plus `tokenizer.json` and weight files (e.g. `*.safetensors`). The proxy only lists directories that have `config.json`. |
| **Get MLX models** | (1) **Convert from HuggingFace:** `./scripts/convert_models.sh mlx <hf_repo>` (e.g. `HuggingFaceTB/SmolLM2-360M-Instruct`). (2) **Pre-converted 4-bit:** Download from the [mlx-community](https://huggingface.co/mlx-community) org on HuggingFace into that folder (e.g. `Llama-3.2-3B-Instruct-4bit`). |
| **First load** | Loading a large MLX model can take 30–90 s. The proxy waits up to 120 s for all servers to report healthy. If LAUNCH SWARM times out, check `logs/<port>.log` and free RAM. |
| **CLEAR KV** | Has no effect on MLX agents; MLX manages its own context. |

See [SETUP_MODELS.md](SETUP_MODELS.md) for detailed model download and conversion (including **convert_models.sh** for both GGUF and MLX, and curl download for non-gated GGUF).

---

## 9. Temperature Guide

```
  0.1          0.3          0.5          0.7          1.0
   │            │            │            │            │
   ▼            ▼            ▼            ▼            ▼
Deterministic  Precise    Balanced    Creative    Exploratory
code gen       debugging  general     design      brainstorm
exact facts    analysis   use         planning    wild ideas
```

| Task | Recommended temperature |
|------|------------------------|
| Generate production code | 0.1 – 0.2 |
| Debug / root cause analysis | 0.1 – 0.3 |
| Write tests | 0.2 – 0.4 |
| Security audit | 0.2 – 0.4 |
| API / schema design | 0.4 – 0.6 |
| Architecture planning | 0.5 – 0.7 |
| Documentation writing | 0.5 – 0.7 |
| Brainstorming / exploration | 0.7 – 1.0 |

---

## 10. History

The last 10 broadcasts are stored in `history.json` and shown in the **HISTORY** dropdown.

```
  [ HISTORY (7) ]
        │
        ▼
  ┌──────────────────────────────────────────┐
  │  design a jwt auth system          14:32 │  ◄ click to reload
  │  refactor the database layer       14:18 │
  │  write tests for the api handler   13:55 │
  │  ...                                     │
  └──────────────────────────────────────────┘
```

Clicking an entry:
- Reloads the prompt text into the input box
- Restores the temperature setting
- Restores all agent responses in the cards
- Restores the CODE OUTPUT panel

History is persistent across sessions — stored in `history.json` in the project root.

---

## 11. KV Cache

The **CLEAR KV** button sends a request to the coordinator, which calls `POST /slots/N?action=erase` on every llama-server port.

```
  CLEAR KV clicked
        │
        ▼
  Coordinator iterates over active ports
        │
    ┌───┴───┐
    │       │
    ▼       ▼
  port    port
  8080    8081    ...
  slots   slots
  erased  erased
        │
        ▼
  Button shows CLEARED (green) briefly
  then returns to idle
```

**When to use it:**
- Agents are producing repetitive or looping output
- You are switching to a completely different topic or codebase
- A session has been running for a long time and responses feel stale

**When not to use it:**
- Mid-conversation when context from previous prompts is still relevant
- When using MLX agents only (has no effect — MLX manages its own state)

---

## 12. How the Coordinator Works

The coordinator (`./coordinator`) is a compiled C++ HTTP server that sits at the centre of the swarm. It is spawned by the Node proxy after all model servers pass their health checks, and it is the only process that communicates directly with the model servers.

### Startup sequence

```
proxy.mjs spawns:
  ./coordinator --config /tmp/matrix-active-config.json
        │
        ▼
  Reads active config → builds agent list in memory
  (name, port, read_timeout_secs, max_tokens, system_prompt)
        │
        ▼
  Loads history.json into memory
        │
        ▼
  Binds HTTP server on 0.0.0.0:8000
        │
        ▼
  Ready — proxy detects /api/health → UI shows ONLINE
```

### Broadcast request lifecycle

```
POST /api/architect
{"prompt": "...", "temperature": 0.7}
        │
        ▼
  Parse prompt + temperature
        │
        ▼
  Launch one std::async future per agent ──────────────────┐
        │                                                   │
        │  Each future calls call_agent():                  │
        │                                                   │
        │  POST /v1/chat/completions  →  model server       │
        │  body: {                                          │
        │    messages: [                                    │
        │      {role:"system", content: <system_prompt>},  │
        │      {role:"user",   content: <user prompt>}     │
        │    ],                                             │
        │    max_tokens: <agent.max_tokens>                 │
        │  }                                               │
        │  (temperature is NOT forwarded to the model)     │
        │                                                   │
        ◄───────────────────────────────────────────────────┘
  Wait for ALL futures (blocks until slowest agent finishes)
        │
        ▼
  Collect responses into JSON map {agentName: responseText}
        │
        ▼
  Append entry to history (mutex-protected):
  {agentName: ..., prompt: ..., temperature: ..., timestamp: ms}
        │
        ▼
  Write history.json to disk
        │
        ▼
  Return response map to proxy → UI
```

### Per-agent limits

| Agent | Read timeout | Max tokens |
|-------|-------------|------------|
| programmer | 300 s | 4096 |
| all others | 60 s | 1024 |
| all agents | 5 s connection timeout | — |

The total broadcast time is determined by whichever agent takes longest. All agents run in parallel — a slow agent does not delay the others, only the final response delivery.

### Error isolation

If an agent's model server is unreachable or times out, `call_agent()` returns an error string for that agent:

```
"Agent architect (Port 8080) is not responding."
"Connection Error (programmer): ..."
```

The other agents' responses are collected and returned normally. A single failure never blocks or corrupts the rest of the swarm response.

### KV cache clear request lifecycle

```
POST /api/clear-cache
        │
        ▼
  Build port → slot_count map
  (groups agents that share the same server port)

  e.g. architect + programmer both on :8080 → slot_count = 2
       specialist on :8081                 → slot_count = 1
        │
        ▼
  Launch one std::async future per unique port
        │
        │  Each future:
        │  for slot in 0..slot_count-1:
        │    POST /slots/<slot>?action=erase  →  llama-server
        │  (MLX servers return 404 — recorded as "partial")
        │
        ▼
  Collect results {portN: "cleared"|"partial"|"error: ..."}
        │
        ▼
  Map results back to agent names
        │
        ▼
  Return {agentName: "cleared"|"partial"|"error"} to UI
```

### Endpoints served by the coordinator

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Liveness check — returns `{"status":"ok"}`. Polled by the UI every 10 s to drive the ONLINE/OFFLINE indicator. |
| `GET` | `/api/agents` | Returns `[{name, port}, ...]` for all loaded agents. Used by the UI to render the agent card grid. |
| `GET` | `/api/history` | Returns the full history array from memory. |
| `POST` | `/api/architect` | Broadcast endpoint. Accepts `{prompt, temperature}`, dispatches to all agents in parallel, saves to history, returns response map. |
| `POST` | `/api/clear-cache` | Clears KV slots on all llama-server ports. |

### Note on temperature

Temperature is accepted in the broadcast request body and stored in `history.json`, but it is **not** included in the `/v1/chat/completions` request sent to the model servers. Each model server uses its own default sampling parameters.

---

## 13. Troubleshooting

### Status stays OFFLINE after LAUNCH SWARM

```
Check logs/8080.log  (or whichever port timed out)
        │
        ├─► "model not found" ──► verify path in CONFIGURE model picker
        │                          paths come from /Users/Shared/llama/models/
        │
        ├─► "address already in use" ──► bash scripts/shutdown_matrix.sh
        │                                 then relaunch
        │
        ├─► "cannot allocate memory" ──► reduce agent count or use smaller models
        │
        └─► blank / empty log ──► llama-server binary missing or not executable
                                   check /Users/Shared/llama/llama-server
```

### Proxy is not running (CONFIGURE shows "BACKEND UNREACHABLE")

```bash
npm run proxy        # start proxy manually
# or
bash scripts/launch_matrix.sh
```

### Agents return "not responding" errors

The model server on that port crashed or was never started. Re-deploy via CONFIGURE → LAUNCH SWARM.

### CLEAR KV shows FAILED

The coordinator could not reach one of the llama-server ports. The servers may have crashed. Re-deploy the swarm.

### MLX (mlx-lm) model not appearing in the engine picker

The model must be a **directory** (not a single file) and contain a `config.json` file. Verify:
```bash
ls /Users/Shared/llama/models/<model-name>/config.json
```
If you only have a HuggingFace repo, convert it first: `./scripts/convert_models.sh mlx <hf_repo>` (requires `pip install mlx-lm`).

### MLX server fails to start or LAUNCH SWARM times out

- Ensure **mlx-lm** is installed: `pip install mlx-lm`
- Check the server log: `logs/<port>.log` (e.g. `logs/8080.log`) for Python or import errors
- First load of a large MLX model can take 30–90 s; the proxy waits up to 120 s. Free RAM and try again

### CODE OUTPUT panel is empty

The programmer agent's response did not contain a fenced code block. Try rephrasing the prompt to explicitly ask for code, or lower the temperature.

### Shutdown

```bash
bash scripts/shutdown_matrix.sh
# or
npm run shutdown
```

This kills all tracked PIDs, llama-server, llama_cpp.server, mlx_lm.server, the coordinator, and the proxy, then force-frees all ports.

### Other options (not built-in)

**Ollama** runs GGUF and other formats with an OpenAI-compatible API on port 11434. Matrix does not start or manage Ollama; if you run Ollama separately and pull models (e.g. `ollama pull llama3.2`), you could point a custom client at it. Adding Ollama as a first-class engine would require coordinator changes (one server, multiple model names) and is not implemented yet.
