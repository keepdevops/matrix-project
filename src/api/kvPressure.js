/**
 * KV-cache pressure polling for vLLM and llama.cpp servers.
 *
 * Prefers Prometheus metric scraping. For llama.cpp builds that no longer
 * expose `llamacpp:kv_cache_usage_ratio`, falls back to the `/slots`
 * endpoint and computes max(n_decoded / n_ctx) across slots.
 */

export const VLLM_METRIC_PORTS = [8080, 8081, 8082, 8083];

const KV_METRIC_PATTERNS = [
  { re: /^vllm:gpu_cache_usage_perc(?:\{[^}]*\})?\s+([\d.eE+-]+)/m, backend: 'vllm' },
  { re: /^llamacpp:kv_cache_usage_ratio(?:\{[^}]*\})?\s+([\d.eE+-]+)/m, backend: 'llama' },
];

async function tryMetrics(port) {
  const res = await fetch(`http://localhost:${port}/metrics`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`status ${res.status}`);
  const text = await res.text();
  for (const { re, backend } of KV_METRIC_PATTERNS) {
    const m = text.match(re);
    if (m) {
      const usage = Number(m[1]);
      if (Number.isFinite(usage)) return { usage, backend };
    }
  }
  return null;
}

async function trySlots(port) {
  const res = await fetch(`http://localhost:${port}/slots`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`/slots status ${res.status}`);
  const slots = await res.json();
  if (!Array.isArray(slots) || slots.length === 0) return null;
  let maxRatio = 0;
  for (const s of slots) {
    const ctx = Number(s?.n_ctx) || 0;
    // llama-server reports current cache fill differently across versions:
    //   - top-level n_decoded
    //   - nested under next_token (object) — older
    //   - nested under next_token[0] (array of sub-states) — newer
    const nt = s?.next_token;
    const ntDecoded = Array.isArray(nt) ? nt[0]?.n_decoded : nt?.n_decoded;
    const decoded = Number(s?.n_decoded ?? ntDecoded) || 0;
    if (ctx > 0) maxRatio = Math.max(maxRatio, decoded / ctx);
  }
  return { usage: maxRatio, backend: 'llama' };
}

export async function fetchKvPressure(ports = VLLM_METRIC_PORTS) {
  return Promise.all(ports.map(async (port) => {
    try {
      const fromMetrics = await tryMetrics(port);
      if (fromMetrics) return { port, ...fromMetrics, ok: true };
      // Metric absent from this build — try /slots before giving up.
      const fromSlots = await trySlots(port);
      if (fromSlots) return { port, ...fromSlots, ok: true };
      return { port, usage: null, backend: null, ok: false };
    } catch (e) {
      console.error(`KV pressure fetch failed for :${port}:`, e);
      return { port, usage: null, backend: null, ok: false, error: e.message };
    }
  }));
}
