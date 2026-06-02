import { API_BASE } from './base';

export async function searchHistory(query, limit = 20) {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  const res = await fetch(`${API_BASE}/history/search?${params}`);
  if (!res.ok) throw new Error(`history search failed (${res.status})`);
  return res.json();
}

export async function forkSession(runId) {
  const res = await fetch(
    `${API_BASE}/history/${encodeURIComponent(runId)}/fork`,
    { method: 'POST' }
  );
  if (!res.ok) throw new Error(`fork failed (${res.status})`);
  return res.json();
}

export async function diffHistory(runIdA, runIdB) {
  const res = await fetch(`${API_BASE}/history/diff`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ run_id_a: runIdA, run_id_b: runIdB }),
  });
  if (!res.ok) throw new Error(`diff failed (${res.status})`);
  return res.json();
}
