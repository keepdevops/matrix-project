import { useEffect, useState } from 'react';
import { fetchAgentHealth } from '../api/swarmApi';

export function useModeHealth() {
  const [health, setHealth] = useState({});

  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      fetchAgentHealth().then(snap => {
        if (cancelled) return;
        const out = {};
        Object.entries(snap || {}).forEach(([k, v]) => {
          if (k !== '__config') out[k] = v;
        });
        setHealth(out);
      }).catch(err => console.warn('[useModeHealth] health fetch failed:', err));
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const tripped = Object.entries(health)
    .filter(([, v]) => v && v.tripped)
    .map(([name, v]) => ({ name, cooldown_s: Math.ceil((v.cooldown_remaining_ms || 0) / 1000) }));

  return { tripped };
}
