/**
 * Shared API infrastructure: base URLs, request coalescing, models cache,
 * and response normalization helpers used by all swarm API modules.
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
  return trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`;
}

export const API_BASE = normalizeApiBase();

/**
 * Base URL for the Python MLX coordinator (hard barrier — never reaches C++).
 * Default: /api/mlx (same-origin via Nginx), or override with REACT_APP_MLX_API_BASE.
 */
export const MLX_API_BASE = (process.env.REACT_APP_MLX_API_BASE || '/api/mlx').replace(/\/+$/, '');

/**
 * Base URL for the RAG ingest sidecar (orchestration/rag/service.py).
 * Default: http://localhost:8001 — set REACT_APP_RAG_INGEST_BASE to override.
 */
export const RAG_INGEST_BASE = (process.env.REACT_APP_RAG_INGEST_BASE
  || 'http://localhost:8001').replace(/\/+$/, '');

/** Concurrent callers await one in-flight request (App + CONFIGURE + panels). */
const inflight = new Map();
export function coalesce(key, fn) {
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
export let modelsCacheValue = null;
export let modelsCacheAt = 0;

export function invalidateModelsCache() {
  modelsCacheValue = null;
  modelsCacheAt = 0;
}

export function setModelsCache(value) {
  modelsCacheValue = value;
  modelsCacheAt = Date.now();
}

/**
 * Normalize a coordinator /api/architect response into { mode, agents, final, meta }.
 * Accepts both the envelope shape (new) and the legacy flat-map shape.
 */
export function normalizeArchitectResponse(raw) {
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
