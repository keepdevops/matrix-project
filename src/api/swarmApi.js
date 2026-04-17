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
 * Submit a prompt to all agents via the coordinator
 */
export async function submitPrompt(prompt, temperature = 0.2) {
  const response = await fetch(`${API_BASE}/architect`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ prompt, temperature }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API error (${response.status}): ${errorText}`);
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
  const response = await fetch(`${API_BASE}/agents`);
  if (!response.ok) throw new Error(`Failed to fetch agents: ${response.status}`);
  return response.json();
}

/**
 * Fetch available model files from the models directory.
 * Merges live proxy results with /models.json static list so that known
 * models appear even when the proxy scanner can't verify them (e.g. empty
 * MLX dirs that haven't been populated yet).
 * Falls back entirely to /models.json when the proxy is unreachable.
 */
export async function fetchModels() {
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
    if (!staticModels.length) throw new Error('Failed to fetch models (proxy and static fallback both unavailable)');
    return staticModels;
  }

  // Merge: add static entries whose path isn't already in the live list
  const livePaths = new Set(liveModels.map(m => m.path));
  const merged = [...liveModels];
  for (const m of staticModels) {
    if (!livePaths.has(m.path)) merged.push(m);
  }
  return merged;
}

/**
 * Fetch base swarm role definitions from swarm-config.json.
 * Falls back to /swarm-config.json (public static) when the proxy is unreachable.
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
    return response.json();
  } catch (e) {
    if (e.name === 'AbortError') {
      throw new Error('Launch timed out (4.5 min). Check logs in CONFIGURE or project logs/ and try again.');
    }
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Clear KV cache on all agents
 */
export async function clearCache() {
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
