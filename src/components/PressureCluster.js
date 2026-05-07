import React, { useEffect, useRef, useState } from 'react';
import { fetchKvPressure } from '../api/swarmApi';

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

// Display caps — anything above pegs the bar at 100%.
const QUEUE_FULL = 16;       // queue depth that fills the queue bar
const WAIT_SLA_SECS = 60;    // wait that fills the wait bar
const TPS_BASELINE = 60;     // tok/s baseline for the decode-rate bar

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

export default function PressureCluster({ online }) {
  const [readings, setReadings] = useState([]);
  const [errored, setErrored] = useState(false);
  const cancelRef = useRef(false);

  useEffect(() => {
    if (!online) {
      setReadings([]);
      setErrored(false);
      return undefined;
    }
    cancelRef.current = false;

    const tick = async () => {
      try {
        const data = await fetchKvPressure();
        if (cancelRef.current) return;
        setReadings(Array.isArray(data) ? data : []);
        setErrored(false);
      } catch (err) {
        // Per project rules: never silent. Log and surface as error state.
        console.error('PressureCluster poll failed:', err);
        if (!cancelRef.current) setErrored(true);
      }
    };

    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelRef.current = true;
      clearInterval(id);
    };
  }, [online]);

  if (!online) return null;

  // Show only MLX entries — the cluster is meaningful for the serialized
  // single-slot backend. llama-server has its own /metrics signals shown
  // by the existing KvPressureGauge.
  const mlx = readings.filter(r => r && r.backend === 'mlx' && r.ok);

  if (errored && mlx.length === 0) {
    return (
      <div className="pcluster pcluster--err" role="status">
        <div className="pcluster-title">MLX pressure</div>
        <div className="pcluster-empty">coordinator unreachable</div>
      </div>
    );
  }
  if (mlx.length === 0) return null;

  return (
    <div className="pcluster" role="group" aria-label="MLX pressure cluster">
      <div className="pcluster-title">MLX pressure</div>
      {mlx
        .slice()
        .sort((a, b) => a.port - b.port)
        .map(entry => (
          <PressureRow key={entry.port} entry={entry} />
        ))}
    </div>
  );
}
