import { API_BASE, coalesce, modelsCacheValue, modelsCacheAt, setModelsCache, invalidateModelsCache } from './base';

const MODELS_CACHE_TTL_MS = 20000;

export { invalidateModelsCache };

/**
 * Fetch available model files from the models directory.
 * Merges live proxy results with /models.json static list so that known
 * models appear even when the proxy scanner can't verify them.
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
      setModelsCache(staticModels);
      return staticModels;
    }

    const livePaths = new Set(liveModels.map(m => m.path));
    const merged = [...liveModels];
    for (const m of staticModels) {
      if (!livePaths.has(m.path)) merged.push(m);
    }
    setModelsCache(merged);
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

export async function clearKvCache() {
  try {
    const response = await fetch(`${API_BASE}/clear-cache`, { method: 'POST' });
    if (!response.ok) throw new Error(`Clear cache failed: ${response.status}`);
    return response.json();
  } catch (e) {
    console.error('[configApi] clearKvCache failed:', e);
    throw e;
  }
}

export async function checkHealth() {
  try {
    const response = await fetch(`${API_BASE}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

export async function fetchCacheStats() {
  try {
    const res = await fetch(`${API_BASE}/cache`);
    if (!res.ok) throw new Error(`cache stats failed (${res.status})`);
    return res.json();
  } catch (e) {
    console.error('[configApi] fetchCacheStats failed:', e);
    throw e;
  }
}

export async function clearCache() {
  try {
    const res = await fetch(`${API_BASE}/cache/clear`, { method: 'POST' });
    if (!res.ok) throw new Error(`cache clear failed (${res.status})`);
    return res.json();
  } catch (e) {
    console.error('[configApi] clearCache failed:', e);
    throw e;
  }
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

export async function checkRagHealth() {
  try {
    const response = await fetch(`${API_BASE}/rag/health`);
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };
    return await response.json();
  } catch (err) {
    console.error('[rag] health probe failed:', err);
    return { ok: false, error: err?.message || 'unreachable' };
  }
}

/** Poll per-port launch progress while a configure is running. */
export async function fetchConfigureStatus() {
  try {
    const res = await fetch(`${API_BASE}/configure/status`);
    if (!res.ok) {
      console.error(`[configure/status] unexpected status ${res.status}`);
      return null;
    }
    return res.json();  // { active: bool, ports: { "3010": "pending"|"ready"|"error" } }
  } catch (e) {
    console.error('[configure/status] fetch failed:', e);
    return null;
  }
}

export async function fetchLogs(ports) {
  if (!ports?.length) return { logs: [] };
  try {
    const q = ports.join(',');
    const response = await fetch(`${API_BASE}/logs?ports=${encodeURIComponent(q)}`);
    if (!response.ok) throw new Error(`Failed to fetch logs: ${response.status}`);
    return response.json();
  } catch (e) {
    console.error('[configApi] fetchLogs failed:', e);
    throw e;
  }
}

/** Timeout slightly over the script's internal 600s health-check window */
const VLLM_START_TIMEOUT_MS = 620_000;

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

export async function startConversion({ hf_repo, output_name, q_bits = 4, hf_token = '' }) {
  const body = { hf_repo, output_name, q_bits };
  if (hf_token) body.hf_token = hf_token;
  const res = await fetch(`${API_BASE}/models/convert`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
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
