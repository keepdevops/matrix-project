import { useState, useCallback } from 'react';
import { forkSession } from '../api/historyApi';

export function useForkSession({ onForked } = {}) {
  const [forking, setForking]       = useState(false);
  const [forkResult, setForkResult] = useState(null);
  const [error, setError]           = useState(null);

  const fork = useCallback(async (runId) => {
    setForking(true);
    setError(null);
    try {
      const result = await forkSession(runId);
      setForkResult(result);
      onForked?.(result);
      return result;
    } catch (err) {
      console.error('[useForkSession] fork failed:', err);
      setError(err.message);
      return null;
    } finally {
      setForking(false);
    }
  }, [onForked]);

  return { fork, forking, forkResult, error };
}
