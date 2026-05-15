import { useEffect, useState } from 'react';
import { checkRagHealth } from '../api/swarmApi';

const POLL_MS = 15000;

/**
 * Polls /api/rag/health on a 15s interval and exposes the latest status.
 * Returns { ok, enabled, embedder, error, loading } — `loading` is true only
 * for the first probe so the UI can avoid flashing a red badge at boot.
 */
export function useRagHealth(enabled = true) {
  const [state, setState] = useState({
    ok: false,
    enabled: false,
    embedder: null,
    error: null,
    loading: true,
  });

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;

    const tick = async () => {
      const data = await checkRagHealth();
      if (cancelled) return;
      setState({
        ok: !!data.ok,
        enabled: !!data.enabled,
        embedder: data.embedder ?? null,
        error: data.error || null,
        loading: false,
      });
    };

    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [enabled]);

  return state;
}

export default useRagHealth;
