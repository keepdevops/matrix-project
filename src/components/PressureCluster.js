import React, { useEffect, useMemo, useRef, useState } from 'react';
import { fetchKvPressure } from '../api/swarmApi';
import { PRESSURE_QUEUE_FULL, PRESSURE_WAIT_SLA_SECS, PRESSURE_TPS_BASELINE } from '../config/thresholds';

// Cluster-of-gauges view of /api/pressure. Each MLX port renders four
// orthogonal channels (active LED, queue depth, expected wait, decode rate)
// instead of collapsing pressure into a single saturating scalar.
//
// Backend contract (see src2/pressure.cpp::mlx_entry):
//   pending             int   queued + active
//   queue_depth         int   max(0, pending-1)
//   slots_busy          0|1
//   decode_rate_tps     number|null   EMA tokens/sec
//   expected_wait_secs  number|null   queue_depth * EMA secs/req
//   avg_request_secs    number|null

const POLL_MS = 500;

const QUEUE_FULL    = PRESSURE_QUEUE_FULL;
const WAIT_SLA_SECS = PRESSURE_WAIT_SLA_SECS;
const TPS_BASELINE  = PRESSURE_TPS_BASELINE;

function clampPct(v, max) {
  if (!Number.isFinite(v) || v <= 0) return 0;
  return Math.min(100, (v / max) * 100);
}

function colorForLoad(pct) {
  if (pct >= 90) return 'var(--kv-crit, #ff4136)';
  if (pct >= 70) return 'var(--kv-warn, #ffae00)';
  return 'var(--kv-ok, #00ff41)';
}

// Decode-rate gauge inverts: low rate = bad. Below 50% baseline is critical.
function colorForRate(pct) {
  if (pct <= 35) return 'var(--kv-crit, #ff4136)';
  if (pct <= 60) return 'var(--kv-warn, #ffae00)';
  return 'var(--kv-ok, #00ff41)';
}

function fmtSecs(s) {
  if (!Number.isFinite(s) || s < 0) return '—';
  if (s < 1) return `${(s * 1000).toFixed(0)}ms`;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m${(s % 60).toFixed(0)}s`;
}

function PressureRow({ entry }) {
  const queuePct = clampPct(entry.queue_depth, QUEUE_FULL);
  const waitPct = clampPct(entry.expected_wait_secs, WAIT_SLA_SECS);
  const tps = entry.decode_rate_tps;
  const tpsPct = clampPct(tps, TPS_BASELINE);
  const active = !!entry.slots_busy;

  const ports = `:${entry.port}`;
  const names = (entry.names || []).join(', ');

  return (
    <div className="pcluster-row" data-active={active ? '1' : '0'}>
      <div className="pcluster-head">
        <span className={`pcluster-led ${active ? 'on' : 'off'}`} />
        <span className="pcluster-port">{ports}</span>
        <span className="pcluster-names">{names}</span>
      </div>

      <div className="pcluster-bars">
        <div className="pcluster-bar" title={`Queue: ${entry.queue_depth} waiting`}>
          <span className="pcluster-bar-label">Q</span>
          <div className="pcluster-bar-track">
            <div
              className="pcluster-bar-fill"
              style={{ width: `${queuePct}%`, background: colorForLoad(queuePct) }}
            />
          </div>
          <span className="pcluster-bar-val">{entry.queue_depth ?? 0}</span>
        </div>

        <div className="pcluster-bar" title="Expected wait until decode begins">
          <span className="pcluster-bar-label">W</span>
          <div className="pcluster-bar-track">
            <div
              className="pcluster-bar-fill"
              style={{ width: `${waitPct}%`, background: colorForLoad(waitPct) }}
            />
          </div>
          <span className="pcluster-bar-val">{fmtSecs(entry.expected_wait_secs)}</span>
        </div>

        <div className="pcluster-bar" title="Decode rate (EMA tokens/sec)">
          <span className="pcluster-bar-label">D</span>
          <div className="pcluster-bar-track">
            <div
              className="pcluster-bar-fill"
              style={{ width: `${tpsPct}%`, background: colorForRate(tpsPct) }}
            />
          </div>
          <span className="pcluster-bar-val">
            {Number.isFinite(tps) && tps > 0 ? `${tps.toFixed(0)}` : '—'}
          </span>
        </div>
      </div>
    </div>
  );
}

export default function PressureCluster({
  online,
  readings: readingsProp,
  fetchFailed: fetchFailedProp,
  poll = true,
}) {
  const [readingsLocal, setReadingsLocal] = useState([]);
  const [erroredLocal, setErroredLocal] = useState(false);
  const cancelRef = useRef(false);
  const useParentFeed = readingsProp !== undefined;

  useEffect(() => {
    if (useParentFeed || !poll) return undefined;
    if (!online) {
      setReadingsLocal([]);
      setErroredLocal(false);
      return undefined;
    }
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
    return () => {
      cancelRef.current = true;
      clearInterval(id);
    };
  }, [online, useParentFeed, poll]);

  const readings = useParentFeed ? (readingsProp || []) : readingsLocal;
  const errored = useParentFeed ? !!fetchFailedProp : erroredLocal;

  const mlx = useMemo(
    () => readings.filter(r => r && r.backend === 'mlx' && r.ok),
    [readings]
  );
  const sortedMlx = useMemo(
    () => mlx.slice().sort((a, b) => a.port - b.port),
    [mlx]
  );

  if (!online) return null;

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
      {sortedMlx.map(entry => (
        <PressureRow key={entry.port} entry={entry} />
      ))}
    </div>
  );
}
