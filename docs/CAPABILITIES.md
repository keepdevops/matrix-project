# Matrix Swarm — Capabilities Reference

Complete reference for everything the coordinator + UI can do beyond
"broadcast a prompt." Use the README for the quickstart; use this doc when
you need to know the exact endpoint, event, or knob.

---

## 1. Orchestration modes

The active mode determines how a single user prompt becomes one or more
agent calls. Switch with `POST /api/modes/active {mode}` or the **MODE**
header dropdown.

| Mode | Behaviour | Reducer? | Use when |
|---|---|---|---|
| `flat` | Broadcast in parallel to every roster agent. | No (`final = null`) | Cross-reference different roles on the same question. |
| `pipeline` | Sequential chain. Each stage receives the previous stage's output. | Optional synthesizer; otherwise last stage is final. | Dependent steps: design → code → review. |
| `cascade` | Parallel broadcast (like flat) followed by a synthesizer reducer. | Required for non-null `final`. | Mixture-of-agents — best of parallel + a coherent answer. |
| `router` | Classifier picks ≤ `max_select` agents from the roster, only those run. | No (selected agents respond independently). | Save tokens when most agents aren't relevant. |

### Per-mode configuration

Each mode gets a config block under `coordinator.modes.<mode>` in the active
config file. Edit via `PUT /api/modes/<mode>/agents`:

```json
{
  "agents": ["architect", "programmer", "reviewer"],   // roster (order matters in pipeline)
  "synthesizer": "architect",                           // pipeline + cascade only
  "max_select": 3                                       // router only
}
```

Empty `agents` ⇒ mode falls back to the full deployed swarm. The
synthesizer agent does not double-execute as a chain stage — it's auto-
excluded from the parallel/sequential dispatch and runs once at the end with
all stage outputs.

### Pipeline staging prompt

Each non-first stage receives:

```
Original user request:
<<<
{user_prompt}
>>>

Previous step ({prev_agent}) produced:
<<<
{prev_output}
>>>

Continue the pipeline.
```

The synthesizer (when configured) gets the original prompt plus all stage
outputs labelled by agent name and is asked to produce a single
consolidated answer.

### Router classifier prompt

Built dynamically each request:

```
Allowed agents: <comma-separated roster>

Current load: programmer 12%, reviewer 0%, tester 80%. Prefer less-loaded
agents when multiple fit the task.

User request:
{user_prompt}

Respond with the SELECTED line only.
```

The load percentages come from `pressure::snapshot_pressure` (KV cache for
llama, queue depth for MLX). The classifier is asked to emit exactly:
`SELECTED: agent1, agent2, ...`. Names outside the roster are filtered out.

---

## 2. Mode presets

Named bundles of `(mode, agents, synthesizer?, max_select?)`. Saved under
`coordinator.presets` in the config file; survive restart and (with
`MATRIX_SOURCE_CONFIG`) UI redeploy.

| Endpoint | Effect |
|---|---|
| `GET /api/presets` | List all presets. |
| `PUT /api/presets/<name>` body `{mode, agents?, synthesizer?, max_select?}` | Create or overwrite. |
| `DELETE /api/presets/<name>` | Remove. |
| `POST /api/presets/<name>/apply` | Copy bundle into `modes_config[mode]`, set that mode active. Unknown agents are dropped and reported in `unknown[]`. |

UI: **PRESETS** panel inside CONFIGURE. "Save active as preset" captures
the active mode's current state under whatever name you type.

---

## 3. Live system-prompt editing

`PUT /api/agents/<name>/prompt {system_prompt}` updates the agent's prompt
in memory, rewrites both the active and source config files, and clears the
response cache (so old cached answers from the old prompt don't leak
through). Useful for tuning `foreman` — the single biggest lever on router
quality.

UI: pencil button (✏️) next to each agent in the CONFIGURE roles list opens
a textarea editor with char/word counter and "Revert to default".

---

## 4. Streaming dispatch (SSE)

`POST /api/architect/stream {prompt}` runs the same dispatch as
`/api/architect` but emits Server-Sent Events. The event taxonomy depends on
the active mode:

| Mode | Event sequence |
|---|---|
| flat | `token*` `agent_done*` `metrics` `done` |
| cascade | `token*` `agent_done*` `synthesis_start` `token*` `agent_done` `metrics` `done` |
| pipeline | (`stage` `token*` `agent_done`)<sup>×N</sup> [`synthesis_start` `token*` `agent_done`] `metrics` `done` |
| router | `selected` `token*` `agent_done*` `metrics` `done` |

Event payloads:

- `token` — `{agent, delta}`
- `agent_done` — `{agent}`
- `stage` — `{step, total, agent}` (pipeline only)
- `selected` — `{classifier, agents[]}` (router only)
- `synthesis_start` — `{agent}` (pipeline + cascade)
- `metrics` — `{agent: {calls, total_ms, completion_tokens, ...}}` (final)
- `done` — `[DONE]`

The streaming dispatch honours both the per-mode roster filter and the
circuit breaker — tripped agents are silently excluded.

---

## 5. Resilience

### Circuit breaker

Per-agent failure tracker. Constants in `agent_health.cpp`:
`WINDOW_MS = 60000`, `THRESHOLD = 3`, `COOLDOWN_MS = 30000`. Three failures
within the window trip the breaker; the agent is excluded from dispatch
until cooldown elapses, then the breaker is half-open and the next call
re-probes (success closes, failure re-opens).

| Surface | Where |
|---|---|
| Per-run exclusion | `envelope.meta.excluded_unhealthy: ["name", ...]` |
| Snapshot endpoint | `GET /api/health/agents` |
| UI | red banner in PER-MODE ROSTER, polled every 5 s |
| Coordinator log | `🔴 [health] <name> breaker TRIPPED (...)` / `🟢 [health] <name> breaker reset` |

### Retry-with-backoff

`agent_client.cpp` retries once (250 ms backoff) on transient HTTP failures:
5xx, empty 200 body, connect timeout, read timeout. 4xx never retries (it's
deterministic — wrong model, bad request). The breaker still counts the
final outcome.

### Skip-with-warning (pipeline)

A failed stage is recorded in `envelope.meta.errors[]` and pinned out of the
chain — the next stage receives the *previous good* output instead of the
error message. Without this, one timeout cascades garbage through the rest
of the pipeline.

```json
"meta": {
  "errors": [{"step": 2, "agent": "programmer",
              "detail": "[programmer error] context size exceeded"}]
}
```

### Synthesis safety (cascade)

Failed parallel agents are excluded from the synthesizer's input prompt and
recorded in `meta.errors[]`. The synthesizer never sees error markers.

---

## 6. Per-run metrics

Every dispatch envelope carries:

```json
"meta": {
  "wall_ms": 4231.7,
  "timings": {
    "architect":  {"calls": 1, "total_ms": 1820.4, "completion_tokens": 412},
    "programmer": {"calls": 1, "total_ms": 2104.2, "completion_tokens": 538}
  }
}
```

The streaming endpoint emits the same payload as a final `metrics` event
before `done`.

UI: **RUN METRICS** strip below FINAL ANSWER. One bar per agent, ranked by
`total_ms`, with per-agent ms / token counts and percentage of total agent
time. Themeable — adapts to the dark/light toggle.

Cache hits: `response_cache::lookup` short-circuits without recording, so a
fully-cached agent shows zero ms. Streaming token counts are word-counts
(SSE chunks don't carry `usage`); off by ~25–40% from a true tokenizer
count but fine for relative comparison.

---

## 7. Persistence

Config writes target two files:

| File | Purpose | Lifetime |
|---|---|---|
| `--config <path>` (the **active** config) | What the coordinator reads on startup. Usually `/tmp/matrix-active-config.json`. | Process restart. |
| `MATRIX_SOURCE_CONFIG=<path>` (the **source** config) | The user-editable canonical config. Usually `swarm-config.json` in the project root. | Survives UI redeploy because `proxy_configure` reads `coordinator.modes` and `coordinator.presets` from source. |

If the env var is unset, only the active config is written — fine for
manual launches but per-mode edits will vanish on the next UI redeploy.

---

## 8. Coordinator HTTP API

| Method · Path | Purpose |
|---|---|
| `GET  /api/health` | Liveness check. |
| `GET  /api/agents` | Active agent list. |
| `GET  /api/modes` · `GET /api/modes/active` · `POST /api/modes/active` | List / read / set active mode. |
| `GET  /api/modes/<name>/agents` · `PUT /api/modes/<name>/agents` | Per-mode roster + synthesizer + max_select. |
| `GET  /api/presets` · `PUT /api/presets/<name>` · `DELETE /api/presets/<name>` · `POST /api/presets/<name>/apply` | Preset CRUD + apply. |
| `PUT  /api/agents/<name>/prompt` | Live system-prompt edit. |
| `GET  /api/health/agents` | Per-agent breaker state. |
| `GET  /api/pressure` | Per-port KV / queue pressure. |
| `POST /api/architect` | Non-streaming dispatch. |
| `POST /api/architect/stream` | Streaming SSE dispatch. |
| `POST /api/clear-cache` | Clear all KV slots. |
| `POST /api/cache/clear` · `POST /api/cache/config` · `GET /api/cache` | Response cache management. |

Coordinator port defaults to 8000; override with `MATRIX_COORDINATOR_PORT`.

---

## 9. Tests

```bash
bash tests/run.sh                          # full suite
bash tests/run.sh -k breaker               # filter
bash tests/run.sh tests/test_streaming.py  # one file
```

The harness (`tests/conftest.py::matrix`) starts 4 mock agents on isolated
ports and the real coordinator on port 18000. No real models needed — runs
in ~30 s.

| File | Coverage |
|---|---|
| `test_modes.py` | Each mode's dispatch shape, roster overrides, synthesis, router classification + filtering. |
| `test_streaming.py` | SSE event taxonomy per mode, breaker × stream interaction. |
| `test_breaker.py` | 3-failure trip, exclusion in `meta.excluded_unhealthy`. |
| `test_presets.py` | CRUD + apply + unknown-agent dropping. |
| `test_resilience.py` | Retry-on-transient, pipeline skip-with-warning, cascade filtering. |
| `test_metrics.py` | `meta.timings` populates, reset between dispatches, streaming `metrics` event. |
| `test_prompts.py` | Live prompt edit takes effect on next dispatch. |

---

## 10. Environment variables

| Var | Default | Effect |
|---|---|---|
| `MATRIX_COORDINATOR_PORT` | `8000` | Coordinator listen port. Tests use 18000. |
| `MATRIX_PROXY_PORT` | `3002` | Proxy listen port. |
| `MATRIX_UI_PORT` | `3000` | React dev server port. |
| `MATRIX_ACTIVE_CONFIG` | `~/.matrix/run/matrix-active-config.json` | Where the proxy stages the deployed config. |
| `MATRIX_SOURCE_CONFIG` | (unset) | If set, coordinator mirrors per-mode + preset edits to this path so they survive UI redeploy. |
| `MATRIX_MODEL_DIR` | `/Users/Shared/llama/models` | Where the proxy scans for models. |
| `MATRIX_LLAMA_SERVER` | (resolved from PATH) | Path to `llama-server` binary. |
| `MATRIX_MLX_PYTHON` | (resolved) | Python interpreter that has `mlx_lm` installed. |
