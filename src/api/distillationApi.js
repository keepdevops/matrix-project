import { API_BASE } from './base';

export async function pushTrajectories({ sessionId, minQuality, targetUrl }) {
  const body = { target_url: targetUrl };
  if (sessionId)        body.session_id  = sessionId;
  if (minQuality > 0)   body.min_quality = minQuality;

  const res = await fetch(`${API_BASE}/export/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`push failed (${res.status})`);
  return res.json();
}
