import React from 'react';
import useKvPressureGauge from './useKvPressureGauge';

function colorFor(pct) {
  if (pct >= 90) return 'var(--kv-crit, #ff4136)';
  if (pct >= 70) return 'var(--kv-warn, #ffae00)';
  return 'var(--kv-ok, #00ff41)';
}

export default function KvPressureGauge({ online, readings = [], fetchFailed = false }) {
  const { displayPct } = useKvPressureGauge({ online, readings });

  if (!online) return null;

  const live = readings.filter(r => r.ok && r.backend !== 'mlx');
  const showErr = live.length === 0 && (fetchFailed || readings.length > 0);
  if (live.length === 0) {
    if (showErr) {
      return (
        <div className="kv-gauge kv-gauge--err" title="vLLM /metrics unreachable">
          <span className="kv-gauge-label">KV</span>
          <span className="kv-gauge-digital kv-gauge-digital--err">
            <span className="kv-gauge-ghost">888</span>
            <span className="kv-gauge-num">---</span>
            <span className="kv-gauge-unit">%</span>
          </span>
        </div>
      );
    }
    return null;
  }

  const maxPct = Math.round(displayPct);
  const tooltip = live
    .map(r => {
      const pct = (r.usage * 100).toFixed(0);
      const tokens = (r.kv_used != null && r.kv_total != null)
        ? ` ${r.kv_used}/${r.kv_total}` : '';
      const slots = r.slots_total ? ` busy ${r.slots_busy ?? 0}/${r.slots_total}` : '';
      return `:${r.port}${r.backend ? ` (${r.backend})` : ''} ${pct}%${tokens}${slots}`;
    })
    .join(' · ');

  return (
    <div className="kv-gauge" title={`KV cache pressure — ${tooltip}`}>
      <span className="kv-gauge-label">KV</span>
      <div className="kv-gauge-track">
        {live.map(r => {
          const pct = Math.round(r.usage * 100);
          return (
            <div key={r.port} className="kv-gauge-seg" style={{ width: `${100 / live.length}%` }}>
              <div className="kv-gauge-fill" style={{ width: `${pct}%`, background: colorFor(pct) }} />
            </div>
          );
        })}
      </div>
      <span className="kv-gauge-digital" style={{ color: colorFor(maxPct) }}>
        <span className="kv-gauge-ghost">888</span>
        <span className="kv-gauge-num">{String(maxPct).padStart(3, '0')}</span>
        <span className="kv-gauge-unit">%</span>
      </span>
    </div>
  );
}
