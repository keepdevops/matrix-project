import { useState, useEffect, useRef } from 'react';
import { fetchTrajectoriesJson } from '../api/trajectoryApi';

const POLL_MS = 5000;

export function useImpactStats({ sessionId, online }) {
  const [stats, setStats] = useState(null);
  const timerRef = useRef(null);

  useEffect(() => {
    if (!online) { setStats(null); return; }
    let cancelled = false;
    const poll = async () => {
      try {
        const data = await fetchTrajectoriesJson(sessionId);
        if (!cancelled && Array.isArray(data) && data.length > 0) {
          const n = data.length;
          const avgTes = data.reduce((s, t) => s + (t.tes || 0), 0) / n;
          const avgImp = data.reduce((s, t) => {
            const scores = Object.values(t.importance_scores || {});
            return s + (scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0);
          }, 0) / n;
          const avgRag = data.reduce((s, t) => s + (t.rag_hit_rate || 0), 0) / n;
          setStats({ count: n, avgTes, avgImp, avgRag });
        } else if (!cancelled) {
          setStats({ count: 0, avgTes: 0, avgImp: 0, avgRag: 0 });
        }
      } catch (err) {
        console.error('[useImpactStats]', err);
      }
      if (!cancelled) timerRef.current = setTimeout(poll, POLL_MS);
    };
    poll();
    return () => { cancelled = true; clearTimeout(timerRef.current); };
  }, [sessionId, online]);

  return stats;
}
