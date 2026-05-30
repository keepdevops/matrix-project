# Matrix Swarm — Help Reference

Quick answers to common questions. For full detail see `USER_MANUAL.md` and `CAPABILITIES.md`.

---

## Getting started in 60 seconds

```bash
# 1. Build C++ binaries (first time only)
bash scripts/build_cpp_binaries.sh

# 2. Pre-flight check
python3 scripts/matrixctl check

# 3. Launch
python3 scripts/matrixctl launch

# 4. Open http://localhost:3000
#    CONFIGURE → pick engine + agents → LAUNCH SWARM → wait for ONLINE
#    Type a prompt → BROADCAST (Cmd+Enter)
```

---

## UI controls

| Control | What it does |
|---|---|
| **ONLINE / OFFLINE** | Coordinator status. OFFLINE (red, blinking) means no swarm is deployed — open CONFIGURE and LAUNCH SWARM first. |
| **MODE dropdown** | Orchestration strategy: flat / pipeline / cascade / router. |
| **CONFIGURE** | Open swarm panel. Choose engine, agents, models; edit system prompts (✏️); click LAUNCH SWARM. |
| **PER-MODE ROSTER** | (Inside CONFIGURE.) Which agents participate per mode; pipeline order; synthesizer; max_select for router. |
| **PRESETS** | Save mode + roster bundle under a name; apply in one click. |
| **CLEAR KV** | Wipe KV cache on llama agents, restart MLX servers, and reset conversation session state. Do this before every new major prompt. |
| **HISTORY (N)** | Last 10 broadcasts; click any to reload prompt + responses. |
| **Temperature** | Default 0.20. Keep 0.10–0.25 for code; 0.40–0.70 for brainstorming. |
| **BROADCAST / Cmd+Enter** | Send prompt under active mode. |
| **ConversationThread** | Collapsible panel showing the multi-turn session history. Sessions auto-continue after the first BROADCAST. |
| **Layout switcher** | Brewlate (default), classic, dashboard, terminal, minimal, sidebar — or `?layout=<name>` in the URL. |
| **RUN METRICS** | Per-agent ms + token bars below FINAL ANSWER. |
| **⤢ on a card** | Open that agent's full response in a CodeMirror editor. |
| **SAVE CODE** | Export all code blocks to a timestamped file. |
| **?** | In-app help modal; links to full docs. |

---

## Orchestration modes

| Mode | Behaviour | When to use |
|---|---|---|
| `flat` | Broadcast to every deployed agent in parallel; no reducer. | Cross-reference different roles on the same question. |
| `pipeline` | Sequential chain; each agent gets the previous output. Optional synthesizer consolidates. | Architect → programmer → reviewer workflows. |
| `cascade` | Parallel broadcast + synthesizer reduces all answers into one. | Best answer from N models with a coherent final response. |
| `router` | Classifier (foreman) picks ≤ `max_select` agents from the roster; load-aware. | Save tokens when only a subset of agents is relevant. |

---

## Agent roles

| Agent | Speciality |
|---|---|
| `architect` | System design, ASCII UML, component diagrams |
| `foreman` | Planning, role assignment; classifier in router mode |
| `programmer` | Full production-ready code (4096 token output) |
| `specialist` | C++/Go, performance, memory, concurrency |
| `security` | OWASP top 10, vulnerability analysis |
| `api` | REST/GraphQL design, OpenAPI specs |
| `database` | Schemas, queries, indexing, SQL/NoSQL |
| `frontend` | React, CSS, accessibility, UX patterns |
| `reviewer` | Bugs, code smells, anti-patterns |
| `tester` | Unit tests, integration tests, edge cases |
| `optimizer` | CPU/memory/IO bottlenecks, algorithms |
| `debugger` | Root cause analysis, targeted fixes |
| `devops` | CI/CD, containers, infrastructure-as-code |
| `scout` | Codebase analysis, module boundaries |
| `synthesis` | Execution roadmaps, risk analysis |
| `documenter` | API docs, READMEs, inline comments |

---

## Inference engines

| Engine | Notes |
|---|---|
| **LLAMA** | `llama-server` from llama.cpp. Loads `.gguf` files. `--parallel N` shares one process across same-model agents. |
| **MLX** | `mlx_lm.server` on Apple Silicon (Metal). Loads model directories. Requests serialise per server. |
| **vLLM** | Docker Model Runner on ports 8080–8083. Four pre-configured models (Qwen2.5-14B, Llama-3.2-3B, DeepSeek-Coder-V2, Phi-4-mini). |
| **Mixed** | Any combination — LLAMA and MLX agents can coexist in one swarm. MLX traffic routes to port 3003 (Python coordinator). |

---

## Common issues

| Issue | Fix |
|---|---|
| UI shows OFFLINE | Click CONFIGURE → LAUNCH SWARM. Check `logs/coordinator.log` if it fails. |
| Agents seem stuck / contradicting | Click CLEAR KV to reset inference state and conversation session. |
| Session not continuing | CLEAR KV was clicked (resets sessions) — BROADCAST again to start a new session. |
| Only one agent responds in router mode | `foreman` system prompt may need tuning — edit it with ✏️ in CONFIGURE. |
| Pipeline output is garbage after stage 2 | A stage failed; check `meta.errors[]` in the API response. The coordinator skips the bad stage automatically. |
| MLX server not starting | Ensure `mlx_lm` is installed (`pip install mlx-lm`) and `MATRIX_MLX_PYTHON` points to the right interpreter. |
| RAG returns no results | Check `bash scripts/rag-docker-compose.sh status`; re-index with `python3 scripts/matrixctl rag index . --embedder hash --force`. |
| Out of VRAM / KV overflow | Reduce active agents to 5–7. Click CLEAR KV between prompts. |

---

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Cmd+Enter` | BROADCAST |
| `Shift+Enter` | Insert newline in prompt box |
| `⌘/Ctrl+Enter` | Validate (standalone config editor) |
| `⌘/Ctrl+S` | Download config when valid; re-validate otherwise (standalone editor) |
| `⌘/Ctrl+G` | Go to line (standalone editor) |
| `⌘/Ctrl+F` | Find (standalone editor) |
| `⌘/Ctrl+Z` / `⌘/Ctrl+Shift+Z` | Undo / redo (standalone editor) |

---

## Further reading

- **[SETUP.md](SETUP.md)** — installation and first-run walkthrough.
- **[USER_MANUAL.md](USER_MANUAL.md)** — end-to-end usage guide with examples.
- **[CAPABILITIES.md](CAPABILITIES.md)** — full API, event taxonomy, env vars, and internals reference.
- **README.md** — project overview, feature list, and repo layout.
