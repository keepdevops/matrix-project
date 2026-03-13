/**
 * MATRIX SWARM API 
 * Target: Node Proxy (3002) -> C++ Coordinator (8000)
 */

const API_BASE = 'http://localhost:3002/api';

/**
 * Submit a prompt to all three agents via the coordinator
 * @param {string} prompt - The user's prompt
 * @param {number} temperature - Temperature setting (0.1 - 1.0)
 * @returns {Promise<{logic: string, utility: string, architect: string}>}
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
 * @returns {Promise<Array>}
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
 * @returns {Promise<Array<{name: string, port: number}>>}
 */
export async function fetchAgents() {
  const response = await fetch(`${API_BASE}/agents`);
  if (!response.ok) throw new Error(`Failed to fetch agents: ${response.status}`);
  return response.json();
}

/**
 * Fetch available GGUF model files from the models directory
 * @returns {Promise<Array<{name: string, path: string}>>}
 */
export async function fetchModels() {
  const response = await fetch(`${API_BASE}/models`);
  if (!response.ok) throw new Error(`Failed to fetch models: ${response.status}`);
  return response.json();
}

/**
 * Fetch base swarm role definitions from swarm-config.json
 * @returns {Promise<Object>}
 */
export async function fetchSwarmConfig() {
  const response = await fetch(`${API_BASE}/swarm-config`);
  if (!response.ok) throw new Error(`Failed to fetch swarm config: ${response.status}`);
  return response.json();
}

/** Timeout for configure (server waits up to 240s; allow a bit more for slow responses) */
const CONFIGURE_TIMEOUT_MS = 270000;

/**
 * Deploy a swarm configuration — starts llama-servers and coordinator
 * @param {Array} agents - Array of agent objects with model assignments
 * @returns {Promise<{status: string, servers: Array}>}
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
 * @returns {Promise<Object>} per-agent status map
 */
export async function clearCache() {
  const response = await fetch(`${API_BASE}/clear-cache`, { method: 'POST' });
  if (!response.ok) throw new Error(`Clear cache failed: ${response.status}`);
  return response.json();
}

/**
 * Check if the coordinator is healthy/online
 * @returns {Promise<boolean>}
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
 * @param {number[]} ports - e.g. [8080, 8081]
 * @returns {Promise<{ logs: Array<{ port: number, lines: string[] }> }>}
 */
export async function fetchLogs(ports) {
  if (!ports?.length) return { logs: [] };
  const q = ports.join(',');
  const response = await fetch(`${API_BASE}/logs?ports=${encodeURIComponent(q)}`);
  if (!response.ok) throw new Error(`Failed to fetch logs: ${response.status}`);
  return response.json();
}
