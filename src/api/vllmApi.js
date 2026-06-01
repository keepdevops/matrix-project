import { API_BASE } from './base';

/** Default vLLM ports — keep in sync with VllmPanel. */
export const VLLM_METRIC_PORTS = [8080, 8081, 8082, 8083];

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
