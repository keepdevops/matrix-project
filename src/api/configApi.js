import { API_BASE, coalesce, modelsCacheValue, modelsCacheAt, setModelsCache, invalidateModelsCache } from './base';

const MODELS_CACHE_TTL_MS = 20000;

export { invalidateModelsCache };
export { fetchHostMemory, fetchKvPressure, clearKvCache, checkHealth, setCacheConfig, checkRagHealth } from './configApi.health';

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

export { VLLM_METRIC_PORTS, startVllmServers, startConversion, pollConversion } from './vllmApi';
