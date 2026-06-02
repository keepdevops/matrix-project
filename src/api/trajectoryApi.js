import { API_BASE } from './base';

export function exportTrajectories(sessionId) {
  const params = sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : '';
  const url = `${API_BASE}/export/rl-trajectories${params}`;
  const a = document.createElement('a');
  a.href = url;
  a.download = sessionId ? `trajectories-${sessionId.slice(0, 12)}.jsonl` : 'trajectories.jsonl';
  a.click();
}

export async function fetchTrajectoriesJson(sessionId) {
  const params = sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : '';
  const res = await fetch(`${API_BASE}/rl-trajectories${params}`);
  if (!res.ok) throw new Error(`fetchTrajectories failed (${res.status})`);
  return res.json();
}
