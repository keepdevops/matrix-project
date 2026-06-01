import { useState, useEffect, useRef } from 'react';
import { API_BASE } from '../api/base';

const POLL_MS = 10000;

export function useCacheStats({ online }) {
  const [stats, setStats] = useState(null);
  const timerRef = useRef(null);

  useEffect(() => {
    if (!online) { setStats(null); return; }
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`${API_BASE}/cache`);
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) {
            const hits   = data.hits   ?? 0;
            const misses = data.misses ?? 0;
            setStats({
              hits, misses,
              size:      data.size      ?? 0,
              evictions: data.evictions ?? 0,
              enabled:   data.enabled   ?? false,
              hit_rate:  (hits + misses) > 0 ? hits / (hits + misses) : 0,
            });
          }
        }
      } catch (err) {
        console.error('[useCacheStats] fetch failed:', err);
      }
      if (!cancelled) timerRef.current = setTimeout(poll, POLL_MS);
    };
    poll();
    return () => { cancelled = true; clearTimeout(timerRef.current); };
  }, [online]);

  return stats;
}
