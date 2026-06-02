import { useState, useEffect } from 'react';
import { diffHistory } from '../api/historyApi';

export function useHistoryDiff() {
  const [entryA, setEntryA] = useState(null);
  const [entryB, setEntryB] = useState(null);
  const [diff, setDiff]     = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState(null);

  useEffect(() => {
    if (!entryA?._run_id || !entryB?._run_id) { setDiff(null); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    diffHistory(entryA._run_id, entryB._run_id)
      .then(d => { if (!cancelled) setDiff(d); })
      .catch(e => { if (!cancelled) { setError(e.message); console.error('[useHistoryDiff]', e); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [entryA, entryB]);

  const clear = () => { setEntryA(null); setEntryB(null); setDiff(null); setError(null); };

  return { entryA, setEntryA, entryB, setEntryB, diff, loading, error, clear };
}
