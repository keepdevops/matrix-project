import { API_BASE, MLX_API_BASE, normalizeArchitectResponse } from './base';
import { buildStreamBody } from './sseStreamReader';
// Routes: /api/architect/stream — callbacks: onToken, onAgentDone, onMetrics
// SSE dispatch: eventName === 'token', eventName === 'metrics' — impl in streamApi.stream.js
export { submitPromptStream, submitPromptStreamMlx } from './streamApi.stream';

/** Clear an MLX session cache. Pass sessionId to clear one, omit to clear all. */
export async function clearMlxSession(sessionId) {
  const body = sessionId ? { session_id: sessionId } : {};
  const res = await fetch(`${MLX_API_BASE}/session/clear`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`mlx session clear failed (${res.status})`);
  return res.json();
}

/** Submit a prompt to all agents via the coordinator (non-streaming). */
export async function submitPrompt(prompt, temperature = 0.2, opts = {}) {
  const body = buildStreamBody(prompt, temperature, opts);
  const response = await fetch(`${API_BASE}/architect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API error (${response.status}): ${errorText}`);
  }
  const raw = await response.json();
  return normalizeArchitectResponse(raw);
}
