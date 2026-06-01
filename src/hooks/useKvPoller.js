import { useEffect, useState } from 'react';
import { fetchKvPressure } from '../api/swarmApi';

const KV_POLL_MS = 250;

/** Polls /api/pressure on the given interval while online. */
export function useKvPoller(online) {
  const [kvReadings, setKvReadings]       = useState([]);
  const [kvFetchFailed, setKvFetchFailed] = useState(false);

  useEffect(() => {
    if (!online) {
      setKvReadings([]);
      setKvFetchFailed(false);
      return undefined;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const data = await fetchKvPressure();
        if (cancelled) return;
        setKvReadings(Array.isArray(data) ? data : []);
        setKvFetchFailed(false);
      } catch (err) {
        console.error('KV pressure poll failed:', err);
        if (!cancelled) setKvFetchFailed(true);
      }
    };
    tick();
    const id = setInterval(tick, KV_POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [online]);

  return { kvReadings, kvFetchFailed };
}
