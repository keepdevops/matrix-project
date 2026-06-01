import { API_BASE } from './base';

export async function fetchTokenBudget(sessionId) {
  if (!sessionId) return null;
  const res = await fetch(`${API_BASE}/token-budget/${encodeURIComponent(sessionId)}`);
  if (!res.ok) throw new Error(`token-budget fetch failed (${res.status})`);
  return res.json();
}
