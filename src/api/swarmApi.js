/**
 * Swarm Matrix API
 * Browser → Proxy (:3002) → Coordinator (:8000)
 *
 * Facade: most call sites import from this module. Helpers live in:
 *   - apiBase.js     — API_BASE resolution
 *   - modes.js       — mode + agent CRUD
 *   - presets.js     — preset CRUD
 *   - kvPressure.js  — KV-cache pressure polling
 */

import { API_BASE } from './apiBase';

export { API_BASE };
export {
  fetchModes,
  fetchActiveMode,
  setActiveMode,
  fetchModeAgents,
  setModeAgents,
  setAgentSystemPrompt,
  setAgentDescription,
  setAgentTokens,
  fetchAgentHealth,
} from './modes';
export {
  fetchPresets,
  savePreset,
  deletePreset,
  applyPreset,
} from './presets';
export { VLLM_METRIC_PORTS, fetchKvPressure } from './kvPressure';

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
  return { mode: null, agents: raw || {}, final: null, meta: {} };
}

export async function submitPrompt(prompt, temperature = 0.2, opts = {}) {
  const body = { prompt, temperature };
  if (opts.refine) body.refine = true;
  if (opts.session) body.session = opts.session;
  const response = await fetch(`${API_BASE}/architect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API error (${response.status}): ${errorText}`);
  }
  return normalizeArchitectResponse(await response.json());
}

export async function fetchHistory() {
  const response = await fetch(`${API_BASE}/history?format=legacy`);
  if (!response.ok) throw new Error(`Failed to fetch history: ${response.status}`);
  return response.json();
}

export async function fetchAgents() {
  const response = await fetch(`${API_BASE}/agents`);
  if (!response.ok) throw new Error(`Failed to fetch agents: ${response.status}`);
  return response.json();
}

export function invalidateModelsCache() { /* no-op: kept for API compatibility */ }

/**
 * Fetch available model files from the live proxy scan. No static fallback —
 * if the proxy is unreachable, surface an explicit error so the UI shows
 * "proxy offline" rather than stale data.
 */
export async function fetchModels() {
  let response;
  try {
    response = await fetch(`${API_BASE}/models`);
  } catch (err) {
    console.error('fetchModels: proxy unreachable', err);
    throw new Error('Cannot fetch models: proxy is not running. Start the proxy and retry.');
  }
  if (!response.ok) {
    const msg = `Failed to fetch models: ${response.status}`;
    console.error('fetchModels:', msg);
    throw new Error(msg);
  }
  return response.json();
}

/**
 * Fetch base swarm role definitions. Falls back to /swarm-config.json
 * (public static) when the proxy is unreachable.
 */
export async function fetchSwarmConfig() {
  try {
    const response = await fetch(`${API_BASE}/swarm-config`);
    if (response.ok) return response.json();
  } catch {
    // proxy not running — fall through to static fallback
  }
  const fallback = await fetch('/swarm-config.json');
  if (!fallback.ok) throw new Error('Failed to fetch swarm config (proxy and static fallback both unavailable)');
  return fallback.json();
}

/** Server health budget is 360s, plus model warmup, coordinator start, and config-write
 *  overhead — large GGUFs (Codestral-22B) regularly need >6 min on cold start. */
const CONFIGURE_TIMEOUT_MS = 600000;
const CONFIGURE_TIMEOUT_LABEL = '10 min';

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
    return response.json();
  } catch (e) {
    if (e.name === 'AbortError') {
      throw new Error(`Launch timed out (${CONFIGURE_TIMEOUT_LABEL}). Check logs in CONFIGURE or project logs/ and try again.`);
    }
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function clearCache() {
  const response = await fetch(`${API_BASE}/clear-cache`, { method: 'POST' });
  if (!response.ok) throw new Error(`Clear cache failed: ${response.status}`);
  return response.json();
}

export async function checkHealth() {
  try {
    const response = await fetch(`${API_BASE}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

/** Fetch last lines of server logs (e.g. for MLX ports when launch fails). */
export async function fetchLogs(ports) {
  if (!ports?.length) return { logs: [] };
  const q = ports.join(',');
  const response = await fetch(`${API_BASE}/logs?ports=${encodeURIComponent(q)}`);
  if (!response.ok) throw new Error(`Failed to fetch logs: ${response.status}`);
  return response.json();
}

/** Slightly over the script's internal 600s health-check window. */
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
