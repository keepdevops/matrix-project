import { API_BASE } from './base';

export function exportTrajectories(opts = {}) {
  const { sessionId, from, to, format, minQuality } = typeof opts === 'string'
    ? { sessionId: opts } : opts;
  const p = new URLSearchParams();
  if (sessionId)              p.set('session_id', sessionId);
  if (from)                   p.set('from', from);
  if (to)                     p.set('to', to);
  if (minQuality > 0)         p.set('min_quality', String(minQuality));
  const qs   = p.toString() ? `?${p}` : '';
  const url  = `${API_BASE}/export/rl-trajectories${qs}`;
  const ext  = format === 'json' ? 'json' : 'jsonl';
  const fname = sessionId ? `trajectories-${sessionId.slice(0,12)}.${ext}` : `trajectories.${ext}`;
  const a = document.createElement('a');
  a.href = url; a.download = fname; a.click();
}

export async function fetchTrajectoriesJson(sessionId) {
  const params = sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : '';
  const res = await fetch(`${API_BASE}/rl-trajectories${params}`);
  if (!res.ok) throw new Error(`fetchTrajectories failed (${res.status})`);
  return res.json();
}
