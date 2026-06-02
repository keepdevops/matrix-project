import { API_BASE } from './base';

export async function submitAnnotation(runId, rating, comment = '') {
  const res = await fetch(`${API_BASE}/annotations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ run_id: runId, rating, comment }),
  });
  if (!res.ok) throw new Error(`submitAnnotation failed (${res.status})`);
  return res.json();
}

export async function fetchAnnotation(runId) {
  const res = await fetch(`${API_BASE}/annotations/${encodeURIComponent(runId)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`fetchAnnotation failed (${res.status})`);
  return res.json();
}

export async function fetchAllAnnotations() {
  const res = await fetch(`${API_BASE}/annotations`);
  if (!res.ok) throw new Error(`fetchAllAnnotations failed (${res.status})`);
  return res.json();
}
