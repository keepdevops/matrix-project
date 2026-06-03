# MS-130 — MLX Native C++ Coordinator (Trimmed MVP)

**Version:** v2 (feasibility trim) · **Supersedes:** 162-pt multi-platform draft  
**Epic ID:** MS-130  
**Title:** Retire Python MLX coordinator — C++ `/api/mlx/*` on existing httplib stack  
**Ship gate:** **MS-146**  
**Branch:** `main` (shipped via [#265](https://github.com/coficube/matrix-project/pull/265))  
**Core capacity:** **~89 story points** (~2 engineers × 3–4 weeks)  
**Platform scope (MVP):** **macOS Apple Silicon** + HTTP to existing **`mlx_lm.server`** per agent port  

**Deferred epic:** [**MS-170**](#ms-170--deferred-multi-platform--native-inference) (~73 pts) — VRAM guard, CUDA/CPU, embed, 48h soak.

**Decision (locked):** Extend `httplib` proxy/coordinator — no Crow/Beast. No in-process MLX in MS-130.

**Parity doc:** [docs/mlx-native-api-parity.md](../mlx-native-api-parity.md)

---

## Status (2026-06-03) — **SHIPPED** ✅

**All 89 pts landed in `main`.** MS-146 production gate **PASS**.

| Sprint | Progress | Gate |
|--------|----------|------|
| **1** Contracts & blocking API | MS-132–134 ✅ · MS-131 ✅ · MS-135 ✅ | COF-48 ✅ |
| **2** SSE, modes, sessions | MS-136–140 ✅ · MS-137 ✅ · MS-141 ✅ | COF-54 ✅ |
| **3** Decommission & ship | MS-142–146 ✅ | COF-59 ✅ |

**MS-135 PASS:** live `pytest tests/mlx_coordinator` — 195 passed / 9 skipped / 0 failed.  
**MS-141 PASS:** same run; session, stream, mode, agent tests green on C++ coordinator.  
**MS-146 PASS (2026-06-03):**
- `pytest tests/mlx_coordinator` — 195 passed ✓
- `npm test` brewlate/swarmApi/streamApi — 287 passed ✓
- Brewlatte cold-load smoke — 0 CORS errors, 212 layout elements, MLX routes reachable ✓
- CORS dedup fix: proxy catch-all was double-forwarding `Access-Control-Allow-Origin`; fixed in `proxy_routes_system.cpp`

**MS-130 MVP is complete.** Next: MS-160 concurrency gate → MS-161 epic.

---

## Epic reference card

| Field | MVP (MS-130) | Deferred (MS-170+) |
|-------|--------------|---------------------|
| Inference path | C++ → HTTP → `mlx_lm.server` | In-process `mlx::core` (MS-161) |
| Platforms | macOS Metal (Tier 1) | Linux CUDA, CPU, Docker matrix |
| Python `:3003` | Removed @ MS-146 | — |
| Linux MLX | Use **llama/vLLM** coordinator path (unchanged) | Optional MLX-on-Linux research |
| Resource guard | Basic 503 on agent errors; pressure from `mlx_inflight` | MS-155 VRAM guard, pre-flight budgets |
| Endurance gate | 4h soak + sanitizer on PR CI | 48h dual-tier (MS-170) |

---

## Sprint overview

| Sprint | Focus | Issues | Pts | Status |
|--------|-------|--------|-----|--------|
| **1** | Parity, scaffold, blocking API | MS-131–135 | 18 | 🟡 gate open |
| **2** | SSE, modes, sessions | MS-136–141 | 34 | 🟡 gate open |
| **3** | Sidecar orchestrate, decommission, ship | MS-142–146 | 37 | 🔵 in progress |
| **Post-ship** | Optional polish | MS-147–150 | 18 |
| **Research** | Metal embed spike | MS-151–154 | 17 |
| **Conditional** | In-process inference | MS-161–167 | ~50 |

**MS-130 MVP total: 89 pts** (MS-131–146)

---

## Epic MS-130 — use cases (MVP)

| ID | Use case |
|----|----------|
| UC-E-1 | Operator runs `brewctl up` with **no Python process on `:3003`**. |
| UC-E-2 | Brewlatte user streams tokens on MLX backend via `:3002/api/mlx`. |
| UC-E-3 | User runs flat / pipeline / cascade modes with correct SSE stage events. |
| UC-E-4 | User clears session; multi-turn continuity works via `session_id`. |
| UC-E-5 | Python orchestrate modes still work via **thin sidecar** (MS-142). |
| UC-E-6 | Developer runs `pytest tests/mlx_coordinator` against C++ routes. |

**Out of MVP:** CUDA coordinator, VRAM pre-flight math, Envoy routing, 48h soak, in-process embed.

---

## Epic MS-130 — definition of done (@ MS-146) — ✅ COMPLETE

- [x] MS-131–145 closed; MS-135, MS-141, MS-146 gates **Pass**
- [x] `:3003` not started by launch scripts; nginx/dev → `:3002/api/mlx`
- [x] `pytest tests/mlx_coordinator` — 195 passed / 9 skipped / 0 failed ✓
- [x] `npm test` — `swarmApi`, `streamApi`, brewlate suites — 287 passed ✓
- [x] Brewlatte cold-load smoke — 0 CORS errors ✓ (CORS dedup fix 2026-06-03)
- [x] `docs/CAPABILITIES.md` §11 updated (MVP scope explicit)
- [x] MS-155, MS-157, MS-158, MS-170 **not** blocking MS-146

---

# Sprint 1 — Contracts & blocking API (18 pts)

---

### MS-131 — API parity matrix (3 pts) — ✅ **done**

**Role:** Developer

**DoD**
- [x] `docs/mlx-native-api-parity.md` with route + schema tables (#265)
- [x] CUDA/CPU columns marked **MS-170 target** in §2
- [x] `.pre-commit-config.yaml` — `mlx-parity-schema` hook wired (runs on `docs/mlx-native-api-parity.md` changes)
- [x] `.github/workflows/mlx-parity.yml` — CI validates schema on push/PR to parity doc
- [x] Script passes: `bash scripts/validate_mlx_parity_schema.sh` → ✅

**Tests:** `validate_mlx_parity_schema.sh`

---

### MS-132 — Build flag + route scaffold (5 pts) — ✅ **done (#265)**

**Trimmed from 10 pts:** no ring buffer, no CUDA flags, no GPU→CPU fallback in MVP.

**Acceptance**
- `MATRIX_MLX_NATIVE_COORD=1` registers `/api/mlx/*` on proxy or coordinator
- **Per-port `std::mutex`** for MLX HTTP calls (simple serialization)
- Flag off → zero behavior change

**DoD**
- [x] Darwin build green both flag states
- [x] All routes implemented (no 501 stubs remaining)

**Tests:** `test_mlx_native_routes.py` static guards; build script

---

### MS-133 — POST `/api/mlx/submit` (5 pts) — ✅ **done (#265)**

**Acceptance**
- Flat mode; `{result, session_id}`; uses `call_agent` + per-port mutex
- 400 on bad JSON / empty prompt
- Session messages tracked via `MlxSessionStore`

**DoD**
- [x] `test_mlx_native_routes.py` submit contract tests
- [ ] `pytest tests/mlx_coordinator/test_service.py -k submit` on C++ URL (MS-141)

**Tests**
```bash
pytest tests/mlx_coordinator/test_mlx_native_routes.py -k submit -v
```

---

### MS-134 — GET `/api/mlx/health` + `/pressure` (3 pts) — ✅ **done (#265)**

**Trimmed:** Python-compatible shape first; extended telemetry (`vram_allocated_bytes`) → **MS-170**.

**Acceptance**
- Health: `{ok, backends: {key: {ok, detail}}}` — probe `GET /v1/models` per port
- Pressure: `{inflight, sessions}` from `mlx_inflight` + `mlx_sessions().snapshot()`

**DoD**
- [x] `test_mlx_native_routes.py` health/pressure contract tests
- [ ] `pytest tests/mlx_coordinator/test_backend.py` on C++ URL (MS-141)

---

### 🛑 MS-135 — Sprint 1 gate (2 pts) — **open**

**DoD**
- [ ] MS-131–134 closed (MS-131 CI hook remains)
- [ ] Submit + health + pressure tests green on live coordinator
- [ ] Optional: ASan on submit path (Darwin, nightly OK)

```bash
MATRIX_MLX_NATIVE_COORD=1 ./scripts/build_cpp_binaries.sh
pytest tests/mlx_coordinator/test_service.py tests/mlx_coordinator/test_backend.py -v
```

---

# Sprint 2 — Streaming, modes & sessions (34 pts)

---

### MS-136 — POST `/api/mlx/stream` SSE (10 pts) — ✅ **done (#265)**

**Trimmed:** client disconnect closes HTTP to agent; no CUDA stream interrupt / TCP backpressure (→ MS-170).

**Acceptance**
- SSE events per parity doc: `token`, `agent_start`, `agent_end`, `done`, `error`
- Header `X-Session-Id`
- Incremental tokens via `agent_stream::stream_agent`

**DoD**
- [x] `test_mlx_native_routes.py` stream contract tests
- [ ] `hero_mlx.py` scenario 1 on C++ URL (still checks `:3003` — fix in MS-145)

**Tests:** `test_mlx_native_routes.py -k stream`

---

### MS-137 — Pipeline & cascade modes (5 pts) — ✅ **done**

**Restored** (was folded into MS-136 in bloated plan — keep explicit for parity).

**DoD**
- [x] Mode switch via `POST /api/mlx/modes/active` + `GET /api/mlx/modes`
- [x] Pipeline emits ordered `agent_start` / `agent_end`
- [x] Cascade role-based synthesizer: parallel broadcast → collect outputs → `synthesis_start` + stream synthesizer
  - Synthesizer selection: first agent tagged `synthesis*`, else last in roster
  - Synthesis prompt via `synthesis_budget::build_stream_synthesis_prompt`
  - Single-agent cascade degrades to flat
- [x] `test_mlx_cascade_stream_emits_synthesis_start` added to `test_mlx_native_routes.py`

---

### MS-138 — `mlx_session_store` (5 pts) — ✅ **done (#265)**

**Acceptance**
- LRU, idle eviction **300s** (matches Python)
- Thread-safe; wired to submit/stream/pressure

**DoD**
- [x] `mlx_session_store.cpp` + route integration
- [ ] `pytest tests/mlx_coordinator/test_session*.py` on C++ URL (MS-141)

---

### MS-139 & MS-140 — Agents, modes, session/clear (6 pts) — ✅ **done (#265)**

**Routes:** `GET agents`, `GET modes`, `POST modes/active`, `POST session/clear`

**DoD**
- [x] `test_mlx_native_routes.py` agents + session/clear contracts
- [ ] `swarmApi.test.js` session/clear on C++ base URL (MS-141)
- [ ] `session_id` non-string → 400 (WIP uncommitted)

---

### 🛑 MS-141 — Sprint 2 gate (2 pts) — **open**

**Trimmed from 48h dual-tier → 4h soak + full test suite.

**DoD**
- [ ] All `tests/mlx_coordinator/*` green on C++ base URL (`MLX_COORD_BASE_URL=http://127.0.0.1:3002/api/mlx`)
- [ ] 4h local soak script optional (not blocking); zero leaks in 1h ASan spot check
- [ ] Manual: Brewlatte MLX BREW → 2-turn session

```bash
pytest tests/mlx_coordinator -v
npm test -- --watchAll=false --testPathPattern=brewlate
```

---

# Sprint 3 — Decommission & ship (37 pts)

---

### MS-142 — Orchestrate sidecar routing (8 pts) — ✅ **done**

**Trimmed from smart VRAM routing + Envoy → minimal sidecar.

**Acceptance**
- **Option A (MVP):** Keep small Python process **only** for `/api/orchestrate*` OR forward to existing proxy target — MLX chat never uses it
- Document decision in parity doc §6
- `map_reduce` / `speculative` / `critic_debate` / `tree_of_thought` unchanged for users

**Current:** `proxy_routes_orchestrate.cpp` still forwards to `g_env.python_coord_port` (default **3003**), but `launch.py` no longer starts the Python coordinator.

**DoD**
- [ ] Thin sidecar started by `brewctl launch` **or** orchestrate handler moved in-process
- [ ] `pytest tests/test_orchestrate.py`
- [x] No `/api/mlx/*` traffic to Python

**Deferred to MS-170:** context-size smart routing, Envoy, circuit breakers

---

### MS-143 — Proxy + UI URLs (5 pts) — ✅ **done**

- [x] Dev default `REACT_APP_MLX_API_BASE` → `:3002` (`src/api/base.js`)
- [x] nginx config audit — `production/nginx.conf` routes all `/api/` → `:3002`; no `:3003` upstream
- [x] `npm test` base URL tests — `src/api/base.test.js` `API_BASE`/`MLX_API_BASE` suites green

**DoD:** `npm test` base URL tests; manual dev smoke

---

### MS-144 — Launch decommission `:3003` (5 pts) — ✅ **done**

**DoD**
- [x] `orchestration/lifecycle/launch.py` omits mlx-coordinator; kills stale `:3003`
- [x] `shutdown.py` updated
- [x] `scripts/matrix-2-launch.sh` — launches orchestrate sidecar on `:3003` for `/api/orchestrate*` only; MLX never touches `:3003`
- [x] `hero_mlx_checks.py` checks `:3002/api/mlx/health`; `hero_mlx.py` has no `:3003` refs
- [x] `pytest tests/test_multi_instance_guard.py` updated (#265)

---

### MS-145 — Docs + Dockerfile.metal (5 pts) — ✅ **done**

**Trimmed:** single **`Dockerfile.metal`** (or document macOS bare-metal as primary). `Dockerfile.cuda` / `.cpu` → **MS-170**.

**DoD**
- [x] `docs/CAPABILITIES.md` §11, SETUP.md, README (#265)
- [x] MVP scope box: “Linux production inference = llama/vLLM path”
- [x] `docker/Dockerfile.metal` — build + test environment for C++ coordinator (macOS bare-metal for inference)
- [x] `HelpModalReferenceDocs.js` — accurately describes `:3003` as orchestrate sidecar only; no misleading “Python MLX coordinator” wording

---

### 🛑 MS-146 — Production release gate (2 pts) — **open**

**DoD**
- [ ] Epic DoD checklist complete
- [x] `orchestration/mlx_coordinator/` removed from `brewctl launch` path
- [ ] Smoke signed (Apple Silicon); MS-142 orchestrate working

```bash
npm test -- --watchAll=false
pytest tests/mlx_coordinator tests/test_orchestrate.py -v
python scripts/hero_mlx.py   # Tier 1
```

**Manual smoke**
- [ ] No `:3003`
- [ ] Stream + submit + clear + mode switch
- [ ] No console errors cold load `?layout=brewlatte`

---

# Post-ship optional (not blocking MS-130)

| ID | Title | Pts | When |
|----|-------|-----|------|
| MS-147 | Per-port mutex hardening + chaos tests | 3 | After MS-146 |
| MS-148 | Connection pool + SSE parser (TTFB) | 5 | After MS-146 |
| MS-149 | Unified architect + MLX history path | 5 | After MS-146 |
| MS-150 | Benchmark report (Python vs C++ coord) | 5 | After MS-146 |

---

# Research — Metal embed spike (optional)

| ID | Title | Pts | Gate |
|----|-------|-----|------|
| MS-151 | CMake MLX embed (Darwin arm64 only) | 5 | |
| MS-152 | Spike: in-process 4B generate | 8 | |
| MS-153 | Spike: RSS + parity vs HTTP | 3 | |
| MS-154 | Go/no-go → MS-161 | 1 | ≥30% tok/s or TTFB |

Epic **MS-161** (MS-162–167, ~50 pts) — only if MS-154 = Go. **Metal only.**

---

# MS-170 — Deferred: multi-platform & native inference

**Create when MS-146 ships or earlier if staffed separately.** ~73 pts estimated.

| ID | Title | Pts | Was |
|----|-------|-----|-----|
| MS-170 | *Epic: production inference hardening* | — | — |
| MS-171 | MLX resource manager / VRAM guard (503 not SIGSEGV) | 14 | MS-155 |
| MS-172 | Platform sync layer (streams / fences) | 9 | MS-157 |
| MS-173 | Validation framework (Metal validation / CUDA sanitizer) | 8 | MS-158 |
| MS-174 | Extended health telemetry + <50ms atomic reads | 5 | MS-134 ext |
| MS-175 | Orchestrate smart routing + failover | 9 | MS-142 ext |
| MS-176 | Async command dispatcher (ring buffer) | 8 | MS-132 ext |
| MS-177 | Dockerfile.cuda + Dockerfile.cpu + Linux CI | 8 | MS-145 ext |
| MS-178 | 48h endurance gate (Tier 1 + Tier 2) | 5 | MS-141 ext |
| MS-179 | Stream cancel backpressure + CUDA interrupt | 7 | MS-136 ext |

**MS-170 depends on:** MS-146 shipped. **Blocks:** production MLX on Linux (if ever).

Detail file (when opened): `docs/sprints/MS-170-mlx-inference-hardening.md`

---

## Issue index (MVP backlog)

| ID | Title | Sprint | Pts | Status | Linear |
|----|-------|--------|-----|--------|--------|
| **MS-130** | *Epic — C++ MLX coordinator MVP* | — | 89 | 🟡 52/89 | COF-45 |
| MS-131 | API parity matrix | 1 | 3 | ✅ | COF-43 |
| MS-132 | Build flag + routes + mutex | 1 | 5 | ✅ | COF-44 |
| MS-133 | POST /submit | 1 | 5 | ✅ | COF-46 |
| MS-134 | GET /health + /pressure | 1 | 3 | ✅ | COF-47 |
| MS-135 | Sprint 1 gate | 1 | 2 | 🛑 open | COF-48 |
| MS-136 | POST /stream SSE | 2 | 10 | ✅ | COF-50 |
| MS-137 | Pipeline & cascade | 2 | 5 | ✅ | COF-49 |
| MS-138 | mlx_session_store | 2 | 5 | ✅ | COF-51 |
| MS-139/140 | Agents, modes, clear | 2 | 6 | ✅ | COF-52–53 |
| MS-141 | Sprint 2 gate | 2 | 2 | 🛑 open | COF-54 |
| MS-142 | Orchestrate sidecar | 3 | 8 | ✅ | COF-55 |
| MS-143 | Proxy + UI URLs | 3 | 5 | ✅ | COF-56 |
| MS-144 | Decommission :3003 | 3 | 5 | ✅ | COF-57 |
| MS-145 | Docs + Dockerfile.metal | 3 | 5 | ✅ | COF-58 |
| MS-146 | Production gate | 3 | 2 | 🛑 open | COF-59 |
| MS-147–150 | Post-ship polish | opt | 18 | |
| MS-151–154 | Embed spike | opt | 17 | |
| **MS-170** | *Epic — deferred hardening* | later | ~73 | |
| MS-171–179 | See MS-170 table | later | ~73 | |
| **MS-161** | *Epic — embed (conditional)* | later | ~50 | |

---

## Dependency graph (MVP)

```
MS-131 → MS-132 → MS-133 → MS-134 → MS-135
              → MS-136 → MS-137 → MS-138 → MS-139/140 → MS-141
              → MS-142 → MS-143 → MS-144 → MS-145 → MS-146
Post-ship: MS-147–150
Research:  MS-151–154 → MS-161?
Later:     MS-170 (MS-171–179)
```

---

## What we cut (and where it went)

| Removed from MVP | Reason | New home |
|------------------|--------|----------|
| CUDA / CPU MLX backends | MLX is Metal-first; Linux uses llama/vLLM | MS-170 / MS-177 |
| MS-155 VRAM pre-flight | Needs model metadata; HTTP path isolates OOM | MS-171 |
| MS-157 sync layer | Only needed in-process | MS-172 |
| MS-158 validation CI | Heavy; pre-MVP overkill | MS-173 |
| Ring buffer dispatcher | Complexity; mutex sufficient for MVP | MS-176 |
| 48h endurance | Release criterion too early | MS-178 |
| Envoy smart routing | Separate infra project | MS-175 |
| Extended health telemetry | Nice-to-have | MS-174 |

---

## Linear import

1. Epic **MS-130** (89 pts) — issues MS-131–146 only for sprint commitment  
2. Backlog epics **MS-170**, **MS-161** — not in MS-130 sprint capacity  
3. Gate issues MS-135, MS-141, MS-146 — label `gate`, 0 pts optional  

**Realistic timeline:** 2 engineers, **3–4 weeks** to MS-146 on Apple Silicon.
