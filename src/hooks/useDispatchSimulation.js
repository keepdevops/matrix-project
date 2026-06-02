import { useState, useCallback } from 'react';
import { API_BASE } from '../api/base';

export function useDispatchSimulation() {
  const [result, setResult]   = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);

  const simulate = useCallback(async (prompt, kvPressure = 0) => {
    if (!prompt?.trim()) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch(`${API_BASE}/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, kv_pressure: kvPressure }),
      });
      if (!res.ok) throw new Error(`simulate failed (${res.status})`);
      setResult(await res.json());
    } catch (err) {
      console.error('[useDispatchSimulation]', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const clear = () => { setResult(null); setError(null); };
  return { simulate, result, loading, error, clear };
}
