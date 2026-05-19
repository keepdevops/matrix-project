# Matrix Swarm — User Manual

End-to-end guide covering daily use, advanced workflows, and configuration.

---

## Table of contents

1. [First launch](#1-first-launch)
2. [Configuring a swarm](#2-configuring-a-swarm)
3. [Sending prompts](#3-sending-prompts)
4. [Reading results](#4-reading-results)
5. [Orchestration modes](#5-orchestration-modes)
6. [Conversation threads](#6-conversation-threads)
7. [Presets](#7-presets)
8. [System-prompt editing](#8-system-prompt-editing)
9. [RAG (context injection)](#9-rag-context-injection)
10. [UI layouts](#10-ui-layouts)
11. [Per-run metrics](#11-per-run-metrics)
12. [Circuit breaker and resilience](#12-circuit-breaker-and-resilience)
13. [Swarm config editor (standalone)](#13-swarm-config-editor-standalone)
14. [Exporting and saving code](#14-exporting-and-saving-code)
15. [Tips and best practices](#15-tips-and-best-practices)

---

## 1. First launch

```bash
bash scripts/build_cpp_binaries.sh   # one-time C++ build
python3 scripts/matrixctl check      # verify ports, binaries, models
python3 scripts/matrixctl launch     # start proxy + UI
```

Open `http://localhost:3000`. See [SETUP.md](SETUP.md) for full prerequisites and troubleshooting.

---

## 2. Configuring a swarm

Click **CONFIGURE** in the header to open the swarm panel.

### 2.1 Choose an inference engine

The panel shows **Using: \<engine\>** and the **SERVER LAYOUT** section lists the active engine.

- **LLAMA** — select `.gguf` model files. Same-model agents share one `llama-server` process via `--parallel N`.
- **MLX** — select model directories (not single files). Runs via the Python MLX coordinator on port 3003. Requests serialise per server.
- **vLLM** — expand the **vLLM INFERENCE SERVERS** panel; start the Docker containers from there.
- **Mixed** — add agents from different engines freely. The proxy routes each agent to the correct backend automatically.

### 2.2 Select agents

Check the agents you want active. 5–7 agents is the sweet spot for coding prompts. 12–16 agents is valid for broad exploration but risks VRAM exhaustion.

### 2.3 Override models per agent

Expand any agent row to point it at a specific model file or directory. Leave blank to use the profile default from `config/agents/<name>.json`.

### 2.4 Launch

Click **LAUNCH SWARM**. The proxy starts one model server per unique model, groups same-model agents together, then boots the C++ coordinator. Allow up to 120 s on first load for large models. The status indicator turns **ONLINE** (blue) when ready.

---

## 3. Sending prompts

### 3.1 Select a mode

Use the **MODE** dropdown in the header. The active mode persists across sessions. See [section 5](#5-orchestration-modes) for mode details.

### 3.2 Set temperature

Default `0.20`. For engineering work stay in `0.10–0.25`. Use `0.40–0.70` only for open-ended brainstorming. Higher values cause agents to contradict each other across a large swarm.

### 3.3 BROADCAST

Click **BROADCAST** or press `Cmd+Enter`. `Shift+Enter` inserts a newline.

The prompt is dispatched according to the active mode. A loading indicator appears on each agent card while it processes.

### 3.4 CLEAR KV

Click **CLEAR KV** before every new major topic. The first prompt fills each agent's KV cache with context; a second unrelated prompt without clearing can leave agents reading contradictory instructions.

CLEAR KV erases llama.cpp KV slots and restarts MLX servers (also resets MLX conversation state).

---

## 4. Reading results

### 4.1 Agent cards

Cards are colour-coded by role. A spinning indicator means the agent is still processing. When done, the card shows the full response with syntax highlighting.

Click **⤢** (top-right of any card) to open the response in a full-screen **CodeMirror editor** with:
- Auto language detection and syntax highlighting.
- Edit mode — modify the response in place.
- Copy to clipboard.
- Export to file.

### 4.2 FINAL ANSWER

For modes with a synthesizer (cascade, pipeline with synthesizer set), the consolidated output appears in the **FINAL ANSWER** panel below the card grid.

### 4.3 CODE OUTPUT

The `programmer` agent's first code block is auto-extracted into a **CODE OUTPUT** panel at the bottom with its own syntax-highlighted CodeMirror editor. Supported languages: C++, Go, Python, JavaScript/TypeScript, Rust, SQL, and more.

### 4.4 HISTORY

Click **HISTORY (N)** to see your last 10 broadcasts. Click any entry to reload the prompt and all agent responses exactly as they were.

---

## 5. Orchestration modes

### flat

Broadcasts the prompt to **every deployed agent** in parallel. The per-mode roster does not apply — flat always uses the full swarm. No reducer: `final` is null, each agent's response stands alone.

Best for: cross-referencing different roles on the same question.

### pipeline

Sequential chain. The roster order determines execution order (reorder via ↑/↓ in PER-MODE ROSTER). Each agent receives the previous agent's output as additional context via the stage prompt:

```
Original user request: <<<{prompt}>>>
Previous step ({agent}) produced: <<<{output}>>>
Continue the pipeline.
```

If a **synthesizer** is set, it runs once at the end with all stage outputs and produces the `final` answer. Otherwise the last stage's output is final.

Failed stages are recorded in `meta.errors[]` and the chain continues from the last good output instead of propagating the error downstream.

Best for: architect → programmer → reviewer chains; multi-step generation + review.

### cascade

Parallel broadcast (like flat) to all roster agents, then a mandatory **synthesizer** reduces every response into one consolidated `final` answer. Failed agents are excluded from the synthesizer's input.

Best for: mixture-of-agents — get diverse parallel answers plus a single coherent synthesis.

### router

A **classifier agent** (foreman by default) inspects the prompt and picks up to `max_select` agents from the per-mode roster. The classifier prompt includes a live **Current load** hint built from KV-cache pressure so the foreman can prefer less-loaded agents.

The `selected` SSE event fires before the chosen agents start, carrying `{classifier, agents[]}`.

Best for: saving tokens when only a subset of agents is relevant per prompt.

---

## 6. Conversation threads

Matrix Swarm supports multi-turn conversations.

- After the first BROADCAST, the UI auto-continues the session on subsequent BROADCASTs without requiring a button.
- The **ConversationThread** panel (collapsible) shows the full turn history for the active session.
- Sessions are identified by `session_id` and persisted in `sessions.json`.
- The streaming route emits a `session` SSE event with `{session_id}` before the first token.
- To start a fresh session, click CLEAR KV (this also resets MLX session state) or start a new tab.

---

## 7. Presets

Presets save the active mode's current configuration (mode, roster, synthesizer, max_select) under a name.

**Save:** In CONFIGURE → PRESETS panel, type a name (e.g. `design-review`) and click Save.

**Apply:** Click **Apply** next to any preset. This switches the active mode and loads the entire bundle in one step. Unknown agents (no longer deployed) are dropped and reported.

**Delete:** Click ✕ next to any preset.

Presets survive coordinator restarts. With `MATRIX_SOURCE_CONFIG` set, they also survive UI redeploy — `proxy_configure` reads `coordinator.presets` from the source config on each deploy.

API: `GET/PUT/DELETE /api/presets/<name>`, `POST /api/presets/<name>/apply`.

---

## 8. System-prompt editing

Click **✏️** next to any agent in CONFIGURE to open a live editor for that agent's `system_prompt`. The editor includes:
- Character and word counter.
- **Revert to default** button.

Saving updates the prompt in memory immediately, rewrites the active and source config files, and clears the response cache so old cached answers don't leak through. The most impactful prompt to tune is `foreman` — it directly controls router mode quality.

API: `PUT /api/agents/<name>/prompt {system_prompt}`.

---

## 9. RAG (context injection)

When RAG is enabled and the pgvector container is running, the coordinator retrieves relevant chunks from the indexed codebase and prepends them to the prompt before dispatch.

### Indexing

```bash
# Start pgvector
bash scripts/rag-docker-compose.sh up

# Index a directory
python3 scripts/matrixctl rag index ./cpp_core --embedder hash

# Index multiple directories
python3 scripts/matrixctl rag index ./cpp_core ./orchestration --embedder hash

# Re-index after code changes
python3 scripts/matrixctl rag index . --embedder hash --force

# Query to verify
python3 scripts/matrixctl rag query "kv router" --top-k 5 --embedder hash
```

`matrixctl launch` auto-indexes when the container is running. Override the DSN with `RAG_DSN=postgresql://...`.

### Enable in config

```json
"rag": { "enabled": true, "top_k": 3, "min_score": 1.0, "embedder": "hash" }
```

`min_score` is a cosine distance ceiling (0 = identical, 1 = orthogonal). Use `1.0` (no filter) for the `hash` embedder; `~0.6` for semantic embedders.

### Request-level toggle

```json
POST /api/architect { "prompt": "...", "use_rag": true, "rag_top_k": 5 }
```

### Per-agent targeting

Set `"use_rag": true` on individual agents in `swarm-config.json` to inject RAG context only for specific roles (e.g. inject codebase context for `programmer` but not `architect`).

### Admin panel

The **RAG ADMIN** panel in the UI provides:
- Index status and chunk count.
- Manual re-index trigger.
- Source list showing which directories are indexed.

Hit metadata appears in `meta.rag` in the response envelope.

---

## 10. UI layouts

Select a layout via the **layout switcher** in the header or append `?layout=<name>` to the URL:

| Layout | Description |
|---|---|
| `default` | Standard card grid. |
| `dashboard` | Metrics strip promoted above the grid. |
| `terminal` | Dense monospace; more agents visible at once. |
| `minimal` | Single-column stripped view; low-resolution / embedded use. |
| `sidebar` | Agent roster sidebar left, content right. |

The layout persists in the URL across reloads. The **visual layout editor** (`/editor`) lets power users arrange custom dashboards in flow, freeform, or grid modes with localStorage persistence.

---

## 11. Per-run metrics

Every dispatch response carries:

```json
"meta": {
  "wall_ms": 4231.7,
  "timings": {
    "architect":  { "calls": 1, "total_ms": 1820, "completion_tokens": 412 },
    "programmer": { "calls": 1, "total_ms": 2104, "completion_tokens": 538 }
  }
}
```

The **RUN METRICS** strip below FINAL ANSWER renders this as a per-agent bar chart ranked by `total_ms`. The streaming endpoint emits the same payload as a final `metrics` SSE event before `done`.

Cached responses show zero ms (the cache short-circuits before timing). Token counts in streaming mode are word-counts (~25–40% off from a true tokenizer count) — use them for relative comparison, not absolute budgeting.

---

## 12. Circuit breaker and resilience

### Circuit breaker

Each agent has its own failure tracker. After **3 failures within 60 s** the breaker opens and that agent is excluded from dispatch for a **30 s cooldown**. Then it goes half-open: the next call re-probes (success closes the breaker; failure re-opens it).

- Tripped agents appear in a **🔴 circuit breaker open** red banner in PER-MODE ROSTER.
- They are listed in `meta.excluded_unhealthy[]` in the response envelope.
- Snapshot: `GET /api/health/agents`.

### Retry

One automatic retry (250 ms backoff) on transient HTTP failures: 5xx, empty 200 body, connect timeout, read timeout. 4xx errors never retry.

### Pipeline skip-with-warning

A failed pipeline stage is recorded in `meta.errors[]` and the chain continues from the last good output. The downstream stage never sees the error message.

### Cascade safety

Failed cascade agents are excluded from the synthesizer's input and recorded in `meta.errors[]`. The synthesizer always receives only successful outputs.

---

## 13. Swarm config editor (standalone)

A guardrailed editor for `swarm-config.json` outside the main UI:

```bash
bash scripts/open-swarmconfig-editor.sh
# or
open tools/swarmconfig-editor.html
```

**Validation enforced before export:** strict JSON + schema checks, unique/safe agent names, duplicate backend+port collision detection, model/path guardrails (blocks `..`, shell metacharacters). Export is disabled until all blocking errors are resolved. Downloaded file is saved as `swarm-config.validated.json`.

**Editing features:** format/minify, copy all / copy validated, drag-and-drop JSON, find/replace, word wrap, font size, light/dark theme, session restore via `localStorage`, undo/redo, JSON merge (agents by name; coordinator/ui deep-merge), agent rename across all roster lists, browser-side presets, path check via File System Access API, agent sidebar jump links, collapsible schema cheat sheet.

**Keyboard shortcuts:**

| Shortcut | Action |
|---|---|
| **⌘/Ctrl+Enter** | Validate |
| **⌘/Ctrl+S** | Download when valid; re-validate otherwise |
| **⌘/Ctrl+G** | Go to line |
| **⌘/Ctrl+F** | Find |
| **⌘/Ctrl+Z** / **⌘/Ctrl+Shift+Z** | Undo / redo |

---

## 14. Exporting and saving code

- **SAVE CODE** — click the button below the agent grid to export all code blocks from every agent's response into a single timestamped file.
- **⤢ editor export** — the full-screen CodeMirror editor has an individual file export button.
- **CODE OUTPUT** — the programmer agent's auto-extracted code block can be copied or saved from the dedicated panel.

---

## 15. Tips and best practices

**5–7 agents is the sweet spot.** Large swarms (12–16) risk VRAM exhaustion and KV token overflow. Use large swarms only for high-level exploration prompts.

**CLEAR KV before every new major prompt.** Stale KV cache causes agents to reference earlier unrelated context. Make it a habit.

**Temperature 0.10–0.25 for code.** Higher values cause agents to contradict each other across parallel responses. Reserve 0.40–0.70 for brainstorming.

**Tune foreman for router mode.** The foreman system prompt is the main lever on classification quality. Edit it live with ✏️ in CONFIGURE.

**Use pipeline for multi-step generation.** architect → programmer → reviewer is the canonical chain. Set a synthesizer on the last stage for a clean final answer.

**Use cascade for best-of-N.** Run 4–6 agents in parallel and let the synthesizer pick the strongest parts of each response.

**Save presets for recurring workflows.** Once you find a good mode + roster combination, save it as a preset so you can apply it in one click on the next session.

**Mix LLAMA and MLX on Apple Silicon.** Add one MLX agent to a LLAMA swarm to compare Metal-optimised inference against llama.cpp on the same broadcast. MLX often produces code faster per-token on M-series hardware.

**Per-mode rosters are independent.** Set a 3-agent router roster and a 7-agent pipeline roster separately. Switch modes without re-configuring.
