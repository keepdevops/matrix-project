import { API_BASE } from './base';

export async function searchHistory(query, limit = 20) {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  const res = await fetch(`${API_BASE}/history/search?${params}`);
  if (!res.ok) throw new Error(`history search failed (${res.status})`);
  return res.json();
}
