/**
 * KV-cache pressure polling for vLLM and llama.cpp servers.
 */

export const VLLM_METRIC_PORTS = [8080, 8081, 8082, 8083];

const KV_METRIC_PATTERNS = [
  /^vllm:gpu_cache_usage_perc(?:\{[^}]*\})?\s+([\d.eE+-]+)/m,
  /^llamacpp:kv_cache_usage_ratio(?:\{[^}]*\})?\s+([\d.eE+-]+)/m,
];

export async function fetchKvPressure(ports = VLLM_METRIC_PORTS) {
  return Promise.all(ports.map(async (port) => {
    try {
      const res = await fetch(`http://localhost:${port}/metrics`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const text = await res.text();
      let usage = null;
      let backend = null;
      for (const re of KV_METRIC_PATTERNS) {
        const m = text.match(re);
        if (m) {
          usage = Number(m[1]);
          backend = re === KV_METRIC_PATTERNS[0] ? 'vllm' : 'llama';
          break;
        }
      }
      const ok = usage !== null && Number.isFinite(usage);
      return { port, usage: ok ? usage : null, backend, ok };
    } catch (e) {
      console.error(`KV pressure fetch failed for :${port}:`, e);
      return { port, usage: null, backend: null, ok: false, error: e.message };
    }
  }));
}
