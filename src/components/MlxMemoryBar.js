import React, { useEffect, useRef, useState } from 'react';
import { fetchMlxPressure } from '../api/configApi.health';

const POLL_MS = 15000;

// MS-171: unified-memory pressure bar for the Monitor popout. Self-fetches
// /api/mlx/pressure; renders nothing until a macOS build returns unified_memory.
export default function MlxMemoryBar({ online }) {
  const [mem, setMem] = useState(null);
  const timer = useRef(null);

  useEffect(() => {
    if (!online) { setMem(null); return undefined; }
    let alive = true;
    const load = async () => {
      const data = await fetchMlxPressure();
      if (alive) setMem(data?.unified_memory ?? null);
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
