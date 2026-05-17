/**
 * Swarm Matrix API
 * Browser → Proxy (:3002) → Coordinator (:8000)
 *
 * Set at build time: REACT_APP_API_BASE
 *   - Dev default: http://localhost:3002/api
 *   - Same-origin (nginx): /api
 */

function normalizeApiBase() {
  const raw = process.env.REACT_APP_API_BASE;
  if (raw === undefined || raw === '') {
    return 'http://localhost:3002/api';
  }
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`;
  }
  // Relative e.g. /api
  return trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`;
}

const API_BASE = normalizeApiBase();

/**
 * Base URL for the RAG ingest sidecar (orchestration/rag/service.py).
 * Default: http://localhost:8001 — set REACT_APP_RAG_INGEST_BASE to override.
 */
const RAG_INGEST_BASE = (process.env.REACT_APP_RAG_INGEST_BASE
  || 'http://localhost:8001').replace(/\/+$/, '');

export async function ragIngestUpload(file) {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(`${RAG_INGEST_BASE}/ingest`, { method: 'POST', body: fd });
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`ingest failed (${res.status}): ${msg}`);
  }
  return res.json();
}

export async function ragIngestJob(jobId) {
  const res = await fetch(`${RAG_INGEST_BASE}/jobs/${encodeURIComponent(jobId)}`);
  if (!res.ok) throw new Error(`job lookup failed (${res.status})`);
  return res.json();
}

export async function ragIngestList() {
  const res = await fetch(`${RAG_INGEST_BASE}/documents`);
  if (!res.ok) throw new Error(`list failed (${res.status})`);
  return res.json();
}

export async function ragIngestDelete(sourcePath) {
  const url = `${RAG_INGEST_BASE}/documents?source=${encodeURIComponent(sourcePath)}`;
  const res = await fetch(url, { method: 'DELETE' });
  if (!res.ok) throw new Error(`delete failed (${res.status})`);
  return res.json();
}

export async function ragIngestHealth() {
  try {
    const res = await fetch(`${RAG_INGEST_BASE}/health`);
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return await res.json();
  } catch (err) {
    console.error('[rag-ingest] health failed:', err);
    return { ok: false, error: err?.message || 'unreachable' };
  }
}

/** Concurrent callers await one in-flight request (App + CONFIGURE + panels). */
const inflight = new Map();
function coalesce(key, fn) {
  const existing = inflight.get(key);
  if (existing) return existing;
  const p = (async () => {
    try {
      return await fn();
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

/** Models list changes rarely; short TTL avoids duplicate scans after shared mounts. */
const MODELS_CACHE_TTL_MS = 20000;
let modelsCacheValue = null;
let modelsCacheAt = 0;

export function invalidateModelsCache() {
  modelsCacheValue = null;
  modelsCacheAt = 0;
}

/**
 * Normalize a coordinator /api/architect response into { mode, agents, final, meta }.
 * Accepts both the envelope shape (new) and the legacy flat-map shape.
 */
function normalizeArchitectResponse(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)
      && raw.agents && typeof raw.agents === 'object') {
    return {
      mode: raw.mode || null,
      agents: raw.agents,
      final: raw.final ?? null,
      meta: raw.meta || {},
    };
  }
  // Legacy: coordinator returned {agent_name: text, ...} directly
  return { mode: null, agents: raw || {}, final: null, meta: {} };
}

/**
 * Submit a prompt to all agents via the coordinator
 */
export async function submitPrompt(prompt, temperature = 0.2, opts = {}) {
  const body = { prompt, temperature };
  if (opts.sessionId) body.session_id = opts.sessionId;
  if (opts.parentRunId) body.parent_run_id = opts.parentRunId;
  if (opts.followup) body.followup = true;
  if (opts.qualityPass) body.quality_pass = true;
  if (opts.contextPolicy) body.context_policy = opts.contextPolicy;
  if (opts.useRag) body.use_rag = true;
  if (opts.ragTopK) body.rag_top_k = opts.ragTopK;
  if (typeof opts.ragMinScore === 'number' && Number.isFinite(opts.ragMinScore)) {
    body.rag_min_score = opts.ragMinScore;
  }
  const response = await fetch(`${API_BASE}/architect`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API error (${response.status}): ${errorText}`);
  }

  const raw = await response.json();
  return normalizeArchitectResponse(raw);
}

/**
 * List all modes registered on the coordinator.
 * Returns [{ name, description, active }].
 */
export async function fetchModes() {
  return coalesce('modes', async () => {
    const response = await fetch(`${API_BASE}/modes`);
    if (!response.ok) throw new Error(`Failed to fetch modes: ${response.status}`);
    return response.json();
  });
}

export async function fetchActiveMode() {
  const response = await fetch(`${API_BASE}/modes/active`);
  if (!response.ok) throw new Error(`Failed to fetch active mode: ${response.status}`);
  const j = await response.json();
  return j.mode || null;
}

export async function setActiveMode(name) {
  const response = await fetch(`${API_BASE}/modes/active`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: name }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Failed to set mode: ${response.status}`);
  }
  return response.json();
}

/**
 * Update an agent's system prompt. Persists to active + source config and
 * clears the response cache (old cached answers came from the old prompt).
 */
export async function setAgentSystemPrompt(name, systemPrompt) {
  const response = await fetch(`${API_BASE}/agents/${encodeURIComponent(name)}/prompt`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ system_prompt: systemPrompt }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Failed to update agent prompt: ${response.status}`);
  }
  return response.json();
}

/**
 * Update an agent's short description. Persisted to swarm-config.json so the
 * value survives restart and applies on the next deploy. Description is
 * prepended to system_prompt when the agent runs in any mode.
 */
export async function setAgentDescription(name, description) {
  const response = await fetch(`${API_BASE}/agents/${encodeURIComponent(name)}/description`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Failed to update agent description: ${response.status}`);
  }
  return response.json();
}

/**
 * Update an agent's token budget. max_tokens takes effect immediately;
 * context is persisted but only applies on next deploy (server restart).
 * Pass either field independently — omitted fields are unchanged.
 */
export async function setAgentTokens(name, { max_tokens, context, read_timeout_secs } = {}) {
  const body = {};
  if (Number.isFinite(max_tokens)) body.max_tokens = max_tokens;
  if (Number.isFinite(context)) body.context = context;
  if (Number.isFinite(read_timeout_secs)) body.read_timeout_secs = read_timeout_secs;
  const response = await fetch(`${API_BASE}/agents/${encodeURIComponent(name)}/tokens`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Failed to update agent tokens: ${response.status}`);
  }
  return response.json();
}

/**
 * Mode presets — named bundles of (mode, agents, synthesizer, max_select).
 */
export async function fetchPresets() {
  const response = await fetch(`${API_BASE}/presets`);
  if (!response.ok) throw new Error(`Failed to fetch presets: ${response.status}`);
  return response.json();
}

export async function savePreset(name, bundle) {
  const response = await fetch(`${API_BASE}/presets/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(bundle),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Failed to save preset: ${response.status}`);
  }
  return response.json();
}

export async function deletePreset(name) {
  const response = await fetch(`${API_BASE}/presets/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error(`Failed to delete preset: ${response.status}`);
  return response.json();
}

export async function applyPreset(name) {
  const response = await fetch(`${API_BASE}/presets/${encodeURIComponent(name)}/apply`, {
    method: 'POST',
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Failed to apply preset: ${response.status}`);
  }
  return response.json();
}

/**
 * Per-agent circuit-breaker snapshot.
 * Shape: { agent_name: { recent_failures, tripped, cooldown_remaining_ms }, __config: {...} }
 */
export async function fetchAgentHealth() {
  const response = await fetch(`${API_BASE}/health/agents`);
  if (!response.ok) throw new Error(`Failed to fetch agent health: ${response.status}`);
  return response.json();
}

/**
 * Get the per-mode agent roster.
 * Returns { mode, agents: string[], explicit: bool, available: string[] }.
 * `agents` is the effective list (falls back to all available when not explicitly set).
 */
export async function fetchModeAgents(name) {
  const response = await fetch(`${API_BASE}/modes/${encodeURIComponent(name)}/agents`);
  if (!response.ok) throw new Error(`Failed to fetch mode agents: ${response.status}`);
  return response.json();
}

/**
 * Set the per-mode agent roster. Order matters for pipeline mode.
 * Pass `agents: []` to clear the override (mode falls back to full active roster).
 */
export async function setModeAgents(name, agentNames, opts = {}) {
  const body = { agents: agentNames };
  if (Number.isInteger(opts.maxSelect)) body.max_select = opts.maxSelect;
  if (opts.synthesizer !== undefined) {
    body.synthesizer = opts.synthesizer || null; // null/empty clears it
  }
  ['variant_policy', 'preset', 'synthesis_policy', 'classifier_policy'].forEach(key => {
    if (opts[key] !== undefined) body[key] = opts[key] || null;
  });
  if (Number.isInteger(opts.stage_context_chars)) {
    body.stage_context_chars = opts.stage_context_chars;
  }
  if (Array.isArray(opts.order)) body.order = opts.order;
  else if (opts.order === null) body.order = null;
  const response = await fetch(`${API_BASE}/modes/${encodeURIComponent(name)}/agents`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Failed to set mode agents: ${response.status}`);
  }
  return response.json();
}

/**
 * Fetch history of previous prompts and responses
 */
export async function fetchHistory() {
  const response = await fetch(`${API_BASE}/history`);

  if (!response.ok) {
    throw new Error(`Failed to fetch history: ${response.status}`);
  }

  return response.json();
}

/**
 * Fetch the list of active agents from the coordinator
 */
export async function fetchAgents() {
  return coalesce('agents', async () => {
    const response = await fetch(`${API_BASE}/agents`);
    if (!response.ok) throw new Error(`Failed to fetch agents: ${response.status}`);
    return response.json();
  });
}

/**
 * Fetch available model files from the models directory.
 * Merges live proxy results with /models.json static list so that known
 * models appear even when the proxy scanner can't verify them (e.g. empty
 * MLX dirs that haven't been populated yet).
 * Falls back entirely to /models.json when the proxy is unreachable.
 */
export async function fetchModels() {
  const now = Date.now();
  if (modelsCacheValue != null && (now - modelsCacheAt) < MODELS_CACHE_TTL_MS) {
    return modelsCacheValue;
  }

  return coalesce('models', async () => {
    let liveModels = null;
    try {
      const response = await fetch(`${API_BASE}/models`);
      if (response.ok) liveModels = await response.json();
    } catch {
      // proxy not running — fall through to static fallback
    }

    const staticRes = await fetch('/models.json');
    const staticModels = staticRes.ok ? await staticRes.json() : [];

    if (!liveModels) {
      if (!staticModels.length) {
        throw new Error('Failed to fetch models (proxy and static fallback both unavailable)');
      }
      modelsCacheValue = staticModels;
      modelsCacheAt = Date.now();
      return staticModels;
    }

    // Merge: add static entries whose path isn't already in the live list
    const livePaths = new Set(liveModels.map(m => m.path));
    const merged = [...liveModels];
    for (const m of staticModels) {
      if (!livePaths.has(m.path)) merged.push(m);
    }
    modelsCacheValue = merged;
    modelsCacheAt = Date.now();
    return merged;
  });
}

/**
 * Fetch base swarm role definitions from swarm-config.json.
 * Falls back to /swarm-config.json (public static) when the proxy is unreachable.
 */
export async function fetchSwarmConfig() {
  return coalesce('swarm-config', async () => {
    try {
      const response = await fetch(`${API_BASE}/swarm-config`);
      if (response.ok) return response.json();
    } catch {
      // proxy not running — fall through to static fallback
    }
    const fallback = await fetch('/swarm-config.json');
    if (!fallback.ok) throw new Error('Failed to fetch swarm config (proxy and static fallback both unavailable)');
    return fallback.json();
  });
}

/** Timeout for configure (server waits up to 240s; allow a bit more for slow responses) */
const CONFIGURE_TIMEOUT_MS = 270000;

/**
 * Deploy a swarm configuration — starts llama-servers and coordinator
 */
export async function configureSwarm(agents) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CONFIGURE_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_BASE}/configure`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agents }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      const msg = err.error || `Configure failed: ${response.status}`;
      const ex = new Error(msg);
      if (err.failedPorts?.length) ex.failedPorts = err.failedPorts;
      throw ex;
    }
    const data = await response.json();
    invalidateModelsCache();
    return data;
  } catch (e) {
    if (e.name === 'AbortError') {
      throw new Error('Launch timed out (4.5 min). Check logs in CONFIGURE or project logs/ and try again.');
    }
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Default vLLM ports — keep in sync with VllmPanel. */
export const VLLM_METRIC_PORTS = [8080, 8081, 8082, 8083];

/**
 * Fetch KV-cache pressure from the coordinator's /api/pressure aggregator,
 * which combines llama.cpp /slots, /props, and /metrics per port.
 * Returns one entry per unique llama-server port:
 *   { port, names, usage (0..1), kv_used, kv_total, slots_busy, slots_total,
 *     backend, ok, error? }
 * Going through the coordinator avoids browser CORS blocks against
 * llama-server and works whether or not --metrics was passed.
 */
export async function fetchKvPressure() {
  try {
    const res = await fetch(`${API_BASE}/pressure`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('expected array from /api/pressure');
    return data;
  } catch (e) {
    console.error('KV pressure fetch failed:', e);
    return [];
  }
}

/**
 * Clear KV cache on all agents
 */
export async function clearKvCache() {
  const response = await fetch(`${API_BASE}/clear-cache`, { method: 'POST' });
  if (!response.ok) throw new Error(`Clear cache failed: ${response.status}`);
  return response.json();
}

/**
 * Check if the coordinator is healthy/online
 */
export async function checkHealth() {
  try {
    const response = await fetch(`${API_BASE}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

export async function fetchCacheStats() {
  const res = await fetch(`${API_BASE}/cache`);
  if (!res.ok) throw new Error(`cache stats failed (${res.status})`);
  return res.json();
}

export async function clearCache() {
  const res = await fetch(`${API_BASE}/cache/clear`, { method: 'POST' });
  if (!res.ok) throw new Error(`cache clear failed (${res.status})`);
  return res.json();
}

export async function setCacheConfig({ enabled, ttl_secs, max_entries } = {}) {
  const body = {};
  if (enabled !== undefined) body.enabled = enabled;
  if (Number.isFinite(ttl_secs)) body.ttl_secs = ttl_secs;
  if (Number.isFinite(max_entries)) body.max_entries = max_entries;
  const res = await fetch(`${API_BASE}/cache/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `cache config failed (${res.status})`);
  }
  return res.json();
}

/**
 * Probe the RAG backing store (pgvector) via the coordinator. Returns
 * { ok, enabled, embedder, top_k, min_score, error? } on success, or
 * { ok: false, error } if the coordinator itself is unreachable.
 */
export async function checkRagHealth() {
  try {
    const response = await fetch(`${API_BASE}/rag/health`);
    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}` };
    }
    return await response.json();
  } catch (err) {
    console.error('[rag] health probe failed:', err);
    return { ok: false, error: err?.message || 'unreachable' };
  }
}

/**
 * Fetch last lines of server logs (e.g. for MLX ports when launch fails)
 */
export async function fetchLogs(ports) {
  if (!ports?.length) return { logs: [] };
  const q = ports.join(',');
  const response = await fetch(`${API_BASE}/logs?ports=${encodeURIComponent(q)}`);
  if (!response.ok) throw new Error(`Failed to fetch logs: ${response.status}`);
  return response.json();
}

/** Timeout slightly over the script's internal 600s health-check window */
const VLLM_START_TIMEOUT_MS = 620_000;

/**
 * Start all four vLLM inference servers via start_vllm_servers.sh --wait.
 * Blocks until all ports pass /v1/models or the 10-minute timeout elapses.
 */
export async function startVllmServers() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), VLLM_START_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_BASE}/inference/vllm/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || `vLLM start failed: ${response.status}`);
    }
    return response.json();
  } catch (e) {
    if (e.name === 'AbortError') {
      throw new Error('vLLM servers did not become healthy within 10 minutes. Check agent_logs/*.log');
    }
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }
}


export async function startConversion({ hf_repo, output_name, q_bits = 4 }) {
  const res = await fetch(`${API_BASE}/models/convert`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hf_repo, output_name, q_bits }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Conversion failed: ${res.status}`);
  }
  return res.json();
}

export async function pollConversion(jobId) {
  const res = await fetch(`${API_BASE}/models/convert/${encodeURIComponent(jobId)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Poll failed: ${res.status}`);
  }
  return res.json();
}
