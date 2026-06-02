import { useState, useEffect, useRef } from 'react';
import { API_BASE } from '../api/base';

const POLL_MS = 5000;

export function useSupervisorAudit({ online }) {
  const [entries, setEntries] = useState([]);
  const timerRef = useRef(null);

  useEffect(() => {
    if (!online) { setEntries([]); return; }
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`${API_BASE}/supervisor/audit`);
        if (res.ok) {
          const data = await res.json();
          if (!cancelled && Array.isArray(data)) setEntries(data);
        }
      } catch (err) {
        console.error('[useSupervisorAudit]', err);
      }
      if (!cancelled) timerRef.current = setTimeout(poll, POLL_MS);
    };
    poll();
    return () => { cancelled = true; clearTimeout(timerRef.current); };
  }, [online]);

  const clear = async () => {
    try {
      await fetch(`${API_BASE}/supervisor/audit`, { method: 'DELETE' });
      setEntries([]);
    } catch (err) { console.error('[useSupervisorAudit] clear failed:', err); }
  };

  return { entries, clear };
}
