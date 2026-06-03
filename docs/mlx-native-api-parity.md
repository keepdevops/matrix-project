# MLX Native API Parity Matrix

**Epic:** MS-130 (MVP) · **Issue:** MS-131  
**Status:** Living document — update on every API change  
**MVP platform:** macOS Apple Silicon · HTTP → `mlx_lm.server`  
**Deferred:** Metal/CUDA/CPU native columns → epic **MS-170** (see §2 note)  
**Baseline (Python):** `orchestration/mlx_coordinator/service.py`, `service_orchestrate.py`  
**Target (C++):** `cpp_core/src/coordinator_routes_mlx.*` (MS-132+)  
**Validation:** `scripts/validate_mlx_parity_schema.sh`

---

## 1. Route inventory

| Method | Path | Python handler | C++ handler (target) | Sprint |
|--------|------|----------------|----------------------|--------|
| POST | `/api/mlx/stream` | `handle_stream` | `register_coordinator_routes_mlx` | ✅ MS-136 |
| POST | `/api/mlx/submit` | `handle_submit` | `register_coordinator_routes_mlx` | ✅ MS-133 |
| GET | `/api/mlx/health` | `handle_health` | `register_coordinator_routes_mlx` | ✅ MS-134 |
| GET | `/api/mlx/pressure` | `handle_pressure` | `register_coordinator_routes_mlx` | ✅ MS-134 |
| GET | `/api/mlx/agents` | `handle_agents` | `register_coordinator_routes_mlx` | ✅ MS-139 |
| GET | `/api/mlx/modes` | `handle_modes` | `register_coordinator_routes_mlx` | ✅ MS-137 |
| POST | `/api/mlx/modes/active` | `handle_set_mode` | `register_coordinator_routes_mlx` | ✅ MS-137 |
| POST | `/api/mlx/session/clear` | `handle_session_clear` | `register_coordinator_routes_mlx` | ✅ MS-140 |
| POST | `/api/orchestrate` | `handle_orchestrate` | `proxy_routes_orchestrate` → sidecar `:3003` | ✅ MS-142 |
| POST | `/api/orchestrate/stream` | `handle_orchestrate_stream` | `proxy_routes_orchestrate` → sidecar `:3003` | ✅ MS-142 |

**URL bases (post MS-143):**

| Environment | Base URL |
|-------------|----------|
| Dev (CRA) | `http://localhost:3002/api/mlx` |
| Production | Same-origin `/api/mlx` via nginx → proxy `:3002` |
| Legacy (deprecated) | `http://localhost:3003/api/mlx` |

---

## 2. Multi-platform memory & limits

> **MVP (MS-130):** Enforce Python-compatible behavior only; OOM isolation stays in `mlx_lm.server` process. Basic **503** on unhealthy agents.  
> **Target (MS-170 / MS-171):** Full guardrails below — not committed for MS-146 ship gate.

Operational guardrails enforced by **MS-171** (deferred resource manager). HTTP surface must return structured errors — never process crash.

| Dimension | Metal (macOS) | CUDA (Linux) | CPU (Linux fallback) |
|-----------|---------------|--------------|----------------------|
| **Memory model** | Unified (CPU+GPU shared) | Discrete VRAM + pinned host | Host RAM only |
| **Availability probe** | `os_proc_available_memory()` (async telemetry thread) | `cudaMemGetInfo` (async telemetry thread only — **not** on HTTP hot path) | `sysinfo` / `/proc/meminfo` |
| **Low-memory action** | GC / cache trim when available **<15%** | Reject pre-launch if context footprint > free VRAM | Reject if RSS budget exceeded |
| **Context budget formula** | `tokens × layers × dim × bytes_per_elem` (same math; unified pool) | Same; compare to `free_vram × safety_factor` | Same; compare to `ram_cap` env |
| **Default wired limit** | 20 GiB (`mx.set_wired_limit` equivalent at boot) | N/A — use VRAM cap config | Conservative RAM cap |
| **Session idle default** | Python: **300s** · C++ target: **1800s** (30 min, MS-138) | same | same |
| **Max sessions** | 50 (Python `SessionStore`) | 50 | 50 |
| **Max messages / session** | 100 | 100 | 100 |
| **Per-port concurrency** | 1 (serialized) | 1 | 1 |
| **Typical scout profile** | 4B MLX ~2.5–5 GB unified | 4B ~4–6 GB VRAM | 4B ~8+ GB RAM |

---

## 3. HTTP error code matrix

| Code | When (all backends) | Response body shape (C++ target) | Python today |
|------|---------------------|----------------------------------|--------------|
| **400** | Invalid JSON; missing `prompt` / `mode`; unknown mode | `{"error":"<message>"}` or aiohttp `reason` text | ✓ |
| **404** | Unregistered route (post-decommission guard) | `{"error":"not found"}` | aiohttp default |
| **429** | Rate / concurrency budget exceeded (MS-155 optional) | `{"error":"too_many_requests","retry_after_ms":N}` | — (new) |
| **501** | Route stub before implementation (MS-132 only) | `{"error":"not implemented"}` | — |
| **503** | Health degraded; VRAM/context budget exceeded; orchestrate memory guard | `{"error":"<message>","code":"insufficient_vram\|memory_guard\|unhealthy"}` | ✓ health 503; orchestrate 503 |
| **507** | Insufficient storage / cache (optional) | `{"error":"insufficient_storage"}` | — (new, optional) |
| **500** | Unhandled mode/inference failure | `{"error":"<message>"}` | ✓ submit 500 |

**Platform-specific error `code` values (MS-155):**

| code | Metal | CUDA | CPU |
|------|-------|------|-----|
| `insufficient_vram` | Mapped to unified memory pressure | Discrete VRAM cap hit | N/A (use `insufficient_ram`) |
| `insufficient_ram` | Rare (unified) | Host OOM guard | RAM cap hit |
| `context_too_large` | Pre-flight token×layer budget | Same | Same |
| `backend_fallback_cpu` | N/A | GPU init failed, serving on CPU (MS-132) | Boot default |

---

## 4. Capability mapping by backend

| Capability | Metal | CUDA | CPU | Notes |
|------------|-------|------|-----|-------|
| Blocking inference (`/submit`) | ✓ | ✓ | ✓ | MS-133 |
| SSE streaming (`/stream`) | ✓ | ✓ | ✓ (slow) | MS-136 |
| Stream cancel / backpressure | ✓ fence | ✓ stream interrupt | ✓ flag | MS-136, MS-157 |
| FP16 / BF16 weights | ✓ native | ✓ if compiled | ✓ | See §7 |
| FP8 weights | Model-dependent | Model-dependent | ✓ promote to FP32 | See §7 |
| Multi-stream lanes | ✓ command buffers | ✓ CUDA streams | ✓ threads | MS-157 |
| Embeddings (`/embed`) | ✗ | ✗ | ✗ | Use RAG sidecar |
| Python orchestrate modes | via sidecar | via sidecar | via sidecar | MS-142 |
| In-process embed (no `mlx_lm.server`) | MS-161 | future | ✓ | Post MS-154 go |

---

## 5. Request / response schemas

### POST `/api/mlx/submit`

**Request:**
```json
{
  "prompt": "string (required)",
  "session_id": "uuid (optional, generated if absent)",
  "params": {}
}
```

**Response 200:**
```json
{
  "result": "string",
  "session_id": "uuid"
}
```

| Field | Metal | CUDA | CPU |
|-------|-------|------|-----|
| Latency target | Baseline | ±10% vs Metal HTTP path | 2–5× Metal |
| Memory on reject | 503 before alloc | 503 before kernel launch | 503 before alloc |

---

### POST `/api/mlx/stream`

**Request:** same as submit.

**Response:** `Content-Type: text/event-stream`, header `X-Session-Id: <uuid>`.

| Event | Data JSON | Notes |
|-------|-----------|-------|
| `token` | `{"text":"…","agent_id":"…"}` | Incremental |
| `agent_start` | `{"agent_id":"…"}` | Pipeline/cascade |
| `agent_end` | `{"agent_id":"…"}` | Pipeline/cascade |
| `done` | `{"meta":{…}}` | Terminal success |
| `error` | `{"error":"…","agent_id":"…\|null"}` | Terminal or inline |

**Orchestrate stream delta:** `/api/orchestrate/stream` `done` includes `result`, `session_id`, `mode`, `meta.timings` — see §5.1.

---

### GET `/api/mlx/health`

**Python baseline 200/503:**
```json
{
  "ok": true,
  "backends": {
    "<agent_key>": {"ok": true, "detail": "port 8083 ok"}
  }
}
```

**C++ target (MS-134) — superset:**
```json
{
  "status": "healthy|degraded|unhealthy",
  "ok": true,
  "backend": "metal|cuda|cpu",
  "compute_units": 0,
  "vram_allocated_bytes": 0,
  "backends": { }
}
```

| Field | Metal | CUDA | CPU |
|-------|-------|------|-----|
| `vram_allocated_bytes` | Unified bytes in use | Device allocated | 0 or RSS proxy |
| Hot-path latency | <50ms p95 | <50ms p95 | <50ms p95 |
| Probe method | Atomic telemetry | Atomic telemetry | Atomic telemetry |

---

### GET `/api/mlx/pressure`

**Python baseline:**
```json
{
  "inflight": {"8083": 0},
  "sessions": [
    {"session_id":"…","messages":2,"idle_secs":1.2}
  ]
}
```

**C++ target:** same shape; `inflight` from `mlx_inflight.cpp`.

---

### GET `/api/mlx/agents`

**Response:** map of agent_id → agent config object (Python `AgentConfig.model_dump()`).

C++ must expose equivalent fields: `name`, `port`, `engine`, `model`, `system_prompt`, `max_tokens`, `context`, etc.

---

### GET `/api/mlx/modes` · POST `/api/mlx/modes/active`

**GET 200:**
```json
{"modes": ["flat","pipeline","cascade"],"active": "flat"}
```

**POST body:** `{"mode": "pipeline"}`  
**POST 200:** `{"active": "pipeline"}`  
**POST 400:** unknown mode

---

### POST `/api/mlx/session/clear`

**POST body:** `{}` (clear all) or `{"session_id": "uuid"}`

**Response (single):** `{"cleared": ["uuid"]}` or `{"cleared": []}`  
**Response (all):** `{"cleared_count": 3}`

| Backend | VRAM reclaim |
|---------|--------------|
| Metal | `mx.metal.clear_cache()` + session drop (MS-138/155) |
| CUDA | Free context handles + sync (MS-155) |
| CPU | Drop session buffers |

---

### 5.1 POST `/api/orchestrate` (proxied, MS-142)

**Request:**
```json
{
  "mode": "map_reduce|speculative|critic_debate|tree_of_thought",
  "prompt": "string",
  "session_id": "optional",
  "params": {},
  "use_rag": false,
  "rag_top_k": 3
}
```

**Response 200:**
```json
{
  "result": "string",
  "session_id": "uuid",
  "mode": "map_reduce",
  "meta": {}
}
```

**Routing (MS-142):** if `estimated_context_bytes` > platform budget → forward to fallback/sidecar **before** native OOM.

---

## 6. Orchestrate sidecar routing (MS-142 decision)

**Decision: Option A — minimal Python sidecar for `/api/orchestrate*` only.**

`orchestration/mlx_coordinator/sidecar.py` — a lean aiohttp process started by
`brewctl launch` — serves only `POST /api/orchestrate` and
`POST /api/orchestrate/stream`. No `/api/mlx/*` traffic reaches Python.
Port: `ORCH_SIDECAR_PORT` (default **3003**); proxy forwards via `g_env.python_coord_port`.

Rationale:
- `map_reduce`, `speculative`, `critic_debate`, `tree_of_thought` use complex
  async Python orchestration (chunking, multi-agent fan-out, scratchpad) that
  has no C++ equivalent in MVP scope.
- Sidecar has no `mlx.core` dependency — works on any engine (llama/mlx share
  the OpenAI `/v1/chat/completions` HTTP API).
- Full C++ orchestrate modes deferred to **MS-170** (post-ship).

Traffic routing after MS-142 / MS-143 / MS-144:
- `/api/mlx/*`        → C++ coordinator `:3002` (native, no Python)
- `/api/orchestrate*` → C++ proxy → Python sidecar `:3003` (`ORCH_SIDECAR_PORT`)
- `/api/architect*`   → C++ coordinator `:3002` (unchanged)

## 6.1 Mode mapping (Python → C++)

| Mode ID | Python class | C++ registration | SSE stage events | Path |
|---------|--------------|------------------|------------------|------|
| `flat` | `FlatMode` | `modes/flat.cpp` | token, agent_start/end | C++ |
| `pipeline` | `PipelineMode` | `modes/pipeline.cpp` | agent_start/end (ordered) | C++ |
| `cascade` | `CascadeMode` | `modes/cascade.cpp` | agent_start/end | C++ |
| `map_reduce` | `MapReduceMode` | — | orchestrate stream | Python sidecar |
| `speculative` | `SpeculativeMode` | — | orchestrate stream | Python sidecar |
| `critic_debate` | `CriticDebateMode` | — | orchestrate stream | Python sidecar |
| `tree_of_thought` | `TreeOfThoughtMode` | — | orchestrate stream | Python sidecar |

---

## 7. Serialization & message format deviations

### 7.1 MLX chat messages (HTTP to agent / native)

| Backend | System prompt | User prompt | OpenAI `role` |
|---------|---------------|-------------|---------------|
| All MLX paths | Merged into single user turn | Same message body | **No** `system` role |

C++ reference: `agent_client_http.cpp` — `engine == "mlx"` merges `system_prompt + "\n\n" + prompt`.

### 7.2 Floating-point / weight formats

| Format | Metal | CUDA | CPU | Wire / API notes |
|--------|-------|------|-----|------------------|
| FP32 | ✓ | ✓ | ✓ | Reference |
| FP16 / BF16 | Native MLX | Native if built | Promote to FP32 compute | JSON numbers remain IEEE float64 in telemetry |
| FP8 | Model dep. | Model dep. | Dequant to FP32 | Log `weight_dtype` in health `detail` when known |
| Token IDs | int32 | int32 | int32 | SSE `text` is UTF-8 string, not token ids |

**Cross-platform rule:** API JSON uses UTF-8 strings and IEEE-754 doubles for metrics; half-precision applies **only** to internal weight tensors, not HTTP payloads.

### 7.3 CORS

All routes: `Access-Control-Allow-Origin: *`, methods `GET, POST, OPTIONS`, header `Content-Type`.

---

## 8. Environment variables

| Variable | Default | Metal | CUDA | CPU |
|----------|---------|-------|------|-----|
| `MATRIX_MLX_NATIVE_COORD` | `0` | Enable C++ routes | same | same |
| `MLX_BACKEND_METAL` | auto Darwin | `1` | — | — |
| `MLX_BACKEND_CUDA` | auto Linux+GPU | — | `1` | — |
| `MLX_BACKEND_CPU` | fallback | — | — | `1` |
| `MATRIX_MLX_VRAM_CAP_BYTES` | model-specific | unified cap | device cap | RAM cap |
| `MATRIX_MLX_CONTEXT_SAFETY` | `0.85` | free×factor | free×factor | free×factor |
| `REACT_APP_MLX_API_BASE` | `:3002/api/mlx` | dev/prod | same | same |
| `MLX_COORD_PORT` | `3003` | **deprecated** MS-144 | deprecated | deprecated |

---

## 9. Test parity map

| Route | Primary pytest | JS test | Gate |
|-------|----------------|---------|------|
| `/submit` | `test_service.py` | — | MS-135 |
| `/stream` | `test_service.py`, `test_service_advanced.py` | `streamApi` | MS-141 |
| `/health` | `test_backend.py` | — | MS-135 |
| `/pressure` | `test_backend.py`, `test_chaos.py` | — | MS-135 |
| `/session/clear` | `test_session.py` | `swarmApi.test.js` | MS-141 |
| `/modes/*` | `test_service.py` | — | MS-141 |
| orchestrate | `tests/test_orchestrate.py` | `orchestrateApi` | MS-146 |
| VRAM guard | `test_vram_guard.py` (new) | — | MS-155 |
| 10-stream sync | `test_chaos.py` | — | MS-157 |

**Run against C++ base:**
```bash
export MLX_COORD_BASE_URL=http://127.0.0.1:3002/api/mlx
export MATRIX_MLX_NATIVE_COORD=1
pytest tests/mlx_coordinator -v
```

---

## 10. Sign-off checklist (MS-131 DoD)

- [ ] All §1 routes have C++ owner file named or `TBD` with sprint ID
- [ ] §2 memory columns reviewed by performance owner
- [ ] §3 error codes implemented for 400/503/429 minimum
- [ ] §5 sample payloads match golden fixtures in `tests/fixtures/mlx_parity/`
- [ ] §6 mode map accurate after MS-142 routing decision
- [ ] §7 serialization rules reflected in `agent_client_http.cpp` / native path
- [ ] `scripts/validate_mlx_parity_schema.sh` passes in pre-commit or CI

---

## Changelog

| Date | Issue | Change |
|------|-------|--------|
| 2026-06-02 | MS-131 | Initial scaffold — Metal/CUDA/CPU columns, route matrix |
| 2026-06-02 | MS-130 v2 | MVP scope: macOS + HTTP only; MS-170 owns native multi-platform |
| 2026-06-02 | #265 | All `/api/mlx/*` routes implemented in C++; orchestrate still `:3003` proxy |
| 2026-06-03 | MS-146 | **SHIPPED** — MS-130 MVP complete. Coordinator starts with `brewctl launch`; all gates pass; Apple Silicon smoke signed off. Deferred: MS-170 (hardening), MS-161 (embed). |
