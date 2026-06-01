import React from 'react';
import { PRESSURE_QUEUE_FULL, PRESSURE_WAIT_SLA_SECS, PRESSURE_TPS_BASELINE } from '../config/thresholds';

const QUEUE_FULL    = PRESSURE_QUEUE_FULL;
const WAIT_SLA_SECS = PRESSURE_WAIT_SLA_SECS;
const TPS_BASELINE  = PRESSURE_TPS_BASELINE;

export function clampPct(v, max) {
  if (!Number.isFinite(v) || v <= 0) return 0;
  return Math.min(100, (v / max) * 100);
}

export function colorForLoad(pct) {
  if (pct >= 90) return 'var(--kv-crit, #ff4136)';
  if (pct >= 70) return 'var(--kv-warn, #ffae00)';
  return 'var(--kv-ok, #00ff41)';
}

// Decode-rate gauge inverts: low rate = bad. Below 50% baseline is critical.
export function colorForRate(pct) {
  if (pct <= 35) return 'var(--kv-crit, #ff4136)';
  if (pct <= 60) return 'var(--kv-warn, #ffae00)';
  return 'var(--kv-ok, #00ff41)';
}

export function fmtSecs(s) {
  if (!Number.isFinite(s) || s < 0) return '—';
  if (s < 1) return `${(s * 1000).toFixed(0)}ms`;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m${(s % 60).toFixed(0)}s`;
}

export default function PressureRow({ entry }) {
  const queuePct = clampPct(entry.queue_depth, QUEUE_FULL);
  const waitPct  = clampPct(entry.expected_wait_secs, WAIT_SLA_SECS);
  const tps      = entry.decode_rate_tps;
  const tpsPct   = clampPct(tps, TPS_BASELINE);
  const active   = !!entry.slots_busy;

  return (
    <div className="pcluster-row" data-active={active ? '1' : '0'}>
      <div className="pcluster-head">
        <span className={`pcluster-led ${active ? 'on' : 'off'}`} />
        <span className="pcluster-port">:{entry.port}</span>
        <span className="pcluster-names">{(entry.names || []).join(', ')}</span>
      </div>

      <div className="pcluster-bars">
        <div className="pcluster-bar" title={`Queue: ${entry.queue_depth} waiting`}>
          <span className="pcluster-bar-label">Q</span>
          <div className="pcluster-bar-track">
            <div className="pcluster-bar-fill"
              style={{ width: `${queuePct}%`, background: colorForLoad(queuePct) }} />
          </div>
          <span className="pcluster-bar-val">{entry.queue_depth ?? 0}</span>
        </div>

        <div className="pcluster-bar" title="Expected wait until decode begins">
          <span className="pcluster-bar-label">W</span>
          <div className="pcluster-bar-track">
            <div className="pcluster-bar-fill"
              style={{ width: `${waitPct}%`, background: colorForLoad(waitPct) }} />
          </div>
          <span className="pcluster-bar-val">{fmtSecs(entry.expected_wait_secs)}</span>
        </div>

        <div className="pcluster-bar" title="Decode rate (EMA tokens/sec)">
          <span className="pcluster-bar-label">D</span>
          <div className="pcluster-bar-track">
            <div className="pcluster-bar-fill"
              style={{ width: `${tpsPct}%`, background: colorForRate(tpsPct) }} />
          </div>
          <span className="pcluster-bar-val">
            {Number.isFinite(tps) && tps > 0 ? `${tps.toFixed(0)}` : '—'}
          </span>
        </div>

        {Number.isFinite(entry.draft_acceptance_rate) && (
          <div className="pcluster-bar"
               title={`Speculative draft acceptance: ${(entry.draft_acceptance_rate * 100).toFixed(0)}%`}>
            <span className="pcluster-bar-label">S</span>
            <div className="pcluster-bar-track">
              <div className="pcluster-bar-fill"
                style={{ width: `${Math.min(100, entry.draft_acceptance_rate * 100).toFixed(0)}%`,
                         background: colorForRate(entry.draft_acceptance_rate * 100) }} />
            </div>
            <span className="pcluster-bar-val">
              {(entry.draft_acceptance_rate * 100).toFixed(0)}%
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
