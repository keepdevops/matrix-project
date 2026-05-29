export const METADATA_KEYS = new Set(['prompt', 'temperature', 'timestamp', '_final', '_mode',
  '_session_id', '_run_id']);

export function bestAgentText(entry) {
  let best = '';
  for (const [k, v] of Object.entries(entry)) {
    if (!METADATA_KEYS.has(k) && typeof v === 'string' && v.length > best.length) best = v;
  }
  return best || null;
}

export function buildSessionList(history) {
  const map = new Map();
  for (const e of history) {
    const sid = e._session_id;
    if (!sid) continue;
    if (!map.has(sid)) {
      map.set(sid, { sessionId: sid, firstPrompt: e.prompt || '', timestamp: e.timestamp, count: 0 });
    }
    map.get(sid).count++;
  }
  return Array.from(map.values()).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
}
