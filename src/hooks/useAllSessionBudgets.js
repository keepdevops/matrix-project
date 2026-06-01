import { useState, useEffect, useRef } from 'react';
import { API_BASE } from '../api/base';

const POLL_MS = 3000;

export function useAllSessionBudgets({ online }) {
  const [sessions, setSessions] = useState([]);
  const timerRef = useRef(null);

  useEffect(() => {
    if (!online) { setSessions([]); return; }
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`${API_BASE}/metrics-json`);
        if (res.ok) {
          const data = await res.json();
          if (!cancelled && Array.isArray(data)) setSessions(data);
        }
      } catch (err) {
        console.error('[useAllSessionBudgets] fetch failed:', err);
      }
      if (!cancelled) timerRef.current = setTimeout(poll, POLL_MS);
    };
    poll();
    return () => {
      cancelled = true;
      clearTimeout(timerRef.current);
    };
  }, [online]);

  return sessions;
}
