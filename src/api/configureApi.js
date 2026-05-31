import { API_BASE, invalidateModelsCache } from './base';

/** Timeout for configure (server waits up to 240s; allow a bit more for slow responses) */
const CONFIGURE_TIMEOUT_MS = 270000;

export async function configureSwarm(agents) {
  if (!Array.isArray(agents) || agents.length === 0) {
    throw new Error('No agents selected — pick at least one agent and assign it a model.');
  }
  for (const a of agents) {
    if (!a.name) throw new Error(`Agent is missing a name: ${JSON.stringify(a)}`);
    if (!a.model) throw new Error(`Agent "${a.name}" has no model selected.`);
  }

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
      console.error('[configureSwarm] server error:', msg);
      throw ex;
    }
    const data = await response.json();
    invalidateModelsCache();
    return data;
  } catch (e) {
    if (e.name === 'AbortError') {
      throw new Error('Launch timed out (4.5 min). Check logs in CONFIGURE or project logs/ and try again.');
    }
    if (e instanceof TypeError && e.message.toLowerCase().includes('fetch')) {
      console.error('[configureSwarm] network error — coordinator unreachable:', e);
      throw new Error('Cannot reach the coordinator — is it running?');
    }
    console.error('[configureSwarm] failed:', e);
    throw e;
  } finally {
    clearTimeout(timeoutId);
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
    return res.json();
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
    console.error('[configureApi] fetchLogs failed:', e);
    throw e;
  }
}

export async function fetchCacheStats() {
  try {
    const res = await fetch(`${API_BASE}/cache`);
    if (!res.ok) throw new Error(`cache stats failed (${res.status})`);
    return res.json();
  } catch (e) {
    console.error('[configureApi] fetchCacheStats failed:', e);
    throw e;
  }
}

export async function clearCache() {
  try {
    const res = await fetch(`${API_BASE}/cache/clear`, { method: 'POST' });
    if (!res.ok) throw new Error(`cache clear failed (${res.status})`);
    return res.json();
  } catch (e) {
    console.error('[configureApi] clearCache failed:', e);
    throw e;
  }
}
