import { API_BASE } from './base';

export async function fetchHostMemory() {
  try {
    const res = await fetch(`${API_BASE}/memory`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const data = await res.json();
    if (!data || typeof data !== 'object') throw new Error('expected object from /api/memory');
    return data;
  } catch (e) {
    console.error('Host memory fetch failed:', e);
    return { ok: false, source: 'host' };
  }
}

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

// MS-171: fetch /api/mlx/pressure — includes unified_memory on macOS builds.
export async function fetchMlxPressure() {
  try {
    const res = await fetch(`${API_BASE}/mlx/pressure`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const data = await res.json();
    if (!data || typeof data !== 'object') return null;
    return data;
  } catch (e) {
    console.error('[fetchMlxPressure] failed:', e);
    return null;
  }
}
