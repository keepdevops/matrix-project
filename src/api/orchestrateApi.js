import { API_BASE } from './base';

/** Split text into n roughly equal word-boundary chunks. */
export function splitIntoChunks(text, n) {
  const words = text.trim().split(/\s+/);
  if (words.length === 0 || n < 1) return [text];
  const size = Math.ceil(words.length / n);
  const chunks = [];
  for (let i = 0; i < words.length; i += size) {
    const chunk = words.slice(i, i + size).join(' ');
    if (chunk) chunks.push(chunk);
  }
  return chunks;
}

/**
 * POST /api/orchestrate — blocking JSON call to the Python mode dispatcher.
 * Returns { result, session_id, mode, meta }.
 */
export async function submitOrchestrate(mode, prompt, params = {}) {
  let res;
  try {
    res = await fetch(`${API_BASE}/api/orchestrate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, prompt, params }),
    });
  } catch (err) {
    console.error('[orchestrate] network error:', err);
    throw new Error(`Orchestrate network error: ${err.message}`);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = body.error || `orchestrate HTTP ${res.status}`;
    console.error('[orchestrate] server error:', msg);
    throw new Error(msg);
  }
  return res.json();
}
