import { useState, useEffect, useRef } from 'react';
import { API_BASE } from '../api/base';

const POLL_MS = 5000;

export function useAgentHealth({ online }) {
  const [byName, setByName] = useState({});
  const timerRef = useRef(null);

  useEffect(() => {
    if (!online) { setByName({}); return; }
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`${API_BASE}/agents/health`);
        if (res.ok) {
          const data = await res.json();
          if (!cancelled && data && typeof data === 'object') setByName(data);
        }
      } catch (err) {
        console.error('[useAgentHealth] fetch failed:', err);
      }
      if (!cancelled) timerRef.current = setTimeout(poll, POLL_MS);
    };
    poll();
    return () => {
      cancelled = true;
      clearTimeout(timerRef.current);
    };
  }, [online]);

  return { byName };
}
