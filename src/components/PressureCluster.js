import React, { useEffect, useMemo, useRef, useState } from 'react';
import { fetchKvPressure } from '../api/swarmApi';
import PressureRow from './PressureRow';

const POLL_MS = 500;

export default function PressureCluster({
  online,
  readings: readingsProp,
  fetchFailed: fetchFailedProp,
  poll = true,
}) {
  const [readingsLocal, setReadingsLocal] = useState([]);
  const [erroredLocal, setErroredLocal]   = useState(false);
  const cancelRef = useRef(false);
  const useParentFeed = readingsProp !== undefined;

  useEffect(() => {
    if (useParentFeed || !poll) return undefined;
    if (!online) { setReadingsLocal([]); setErroredLocal(false); return undefined; }
    cancelRef.current = false;

    const tick = async () => {
      try {
        const data = await fetchKvPressure();
        if (cancelRef.current) return;
        setReadingsLocal(Array.isArray(data) ? data : []);
        setErroredLocal(false);
      } catch (err) {
        console.error('PressureCluster poll failed:', err);
        if (!cancelRef.current) setErroredLocal(true);
      }
    };

    tick();
    const id = setInterval(tick, POLL_MS);
    return () => { cancelRef.current = true; clearInterval(id); };
  }, [online, useParentFeed, poll]);

  const readings = useMemo(
    () => (useParentFeed ? (readingsProp || []) : readingsLocal),
    [useParentFeed, readingsProp, readingsLocal],
  );
  const errored  = useParentFeed ? !!fetchFailedProp : erroredLocal;

  const mlx = useMemo(() => readings.filter(r => r && r.backend === 'mlx' && r.ok), [readings]);
  const sortedMlx = useMemo(() => mlx.slice().sort((a, b) => a.port - b.port), [mlx]);

  if (!online) {
    return (
      <div className="pcluster pcluster--idle" role="status">
        <div className="pcluster-title">MLX pressure</div>
        <div className="pcluster-empty">offline</div>
      </div>
    );
  }

  if (errored && mlx.length === 0) {
    return (
      <div className="pcluster pcluster--err" role="status">
        <div className="pcluster-title">MLX pressure</div>
        <div className="pcluster-empty">coordinator unreachable</div>
      </div>
    );
  }
  if (mlx.length === 0) {
    return (
      <div className="pcluster pcluster--idle" role="status">
        <div className="pcluster-title">MLX pressure</div>
        <div className="pcluster-empty">No MLX ports reporting — deploy MLX agents or check coordinator</div>
      </div>
    );
  }

  return (
    <div className="pcluster" role="group" aria-label="MLX pressure cluster">
      <div className="pcluster-title">MLX pressure</div>
      {sortedMlx.map(entry => <PressureRow key={entry.port} entry={entry} />)}
    </div>
  );
}
