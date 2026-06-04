import React, { useEffect, useRef, useState } from 'react';
import { fetchMlxPressure, fetchHostMemory } from '../api/configApi.health';

const POLL_MS = 15000;

// MS-171: unified-memory pressure bar for the Monitor popout. Prefers
// /api/mlx/pressure's unified_memory (native MLX builds); falls back to the
// always-available /api/memory host snapshot so the gauge still shows on plain
// coordinator builds. Renders nothing only when no memory telemetry is available.
export default function MlxMemoryBar({ online }) {
  const [mem, setMem] = useState(null);
  const timer = useRef(null);

  useEffect(() => {
    if (!online) { setMem(null); return undefined; }
    let alive = true;
    const load = async () => {
      let um = (await fetchMlxPressure())?.unified_memory ?? null;
      if (!um) {
        // Fallback: /api/memory is served by every coordinator build.
        const host = await fetchHostMemory();
        if (host?.ok && host.total_gb > 0) {
          um = {
            total_gb: host.total_gb,
            free_gb: host.free_gb,
            pressure_pct: Math.round((1 - host.free_gb / host.total_gb) * 100),
          };
        }
      }
      if (alive) setMem(um);
    };
    load();
    timer.current = setInterval(load, POLL_MS);
    return () => { alive = false; clearInterval(timer.current); };
  }, [online]);

  if (!mem) return null;

  const pct = Math.max(0, Math.min(100, mem.pressure_pct ?? 0));
  const color = pct >= 90 ? 'var(--color-danger, #ef4444)'
    : pct >= 75 ? 'var(--kv-warn, #ffae00)'
    : 'var(--color-primary, #4a9eff)';

  return (
    <div className="mlx-mem-bar">
      <div className="mlx-mem-bar-header">
        <span className="mlx-mem-bar-title">Unified Memory</span>
        <span className="mlx-mem-bar-stat">
          {mem.free_gb}GB free / {mem.total_gb}GB · {pct}%
        </span>
      </div>
      <div className="mlx-mem-bar-track">
        <div className="mlx-mem-bar-fill"
             style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}
