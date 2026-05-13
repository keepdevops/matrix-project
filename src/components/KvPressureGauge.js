import React, { useEffect, useState } from 'react';
import { fetchKvPressure } from '../api/swarmApi';
import { useKvSettings } from '../context/KvSettingsContext';

export default function KvPressureGauge({ online, agents = [] }) {
  const { warnPct, critPct, pollSec, extraPorts } = useKvSettings();
  const [readings, setReadings] = useState([]);
  const [errored, setErrored] = useState(false);

  const colorFor = pct =>
    pct >= critPct ? 'var(--kv-crit, #ff4136)' :
    pct >= warnPct ? 'var(--kv-warn, #ffae00)' :
                     'var(--kv-ok, #00ff41)';

  // Auto-derive deployed-agent ports; merge user-supplied extras.
  // Sort + dedupe so the effect doesn't re-fire on key reorderings.
  const portsKey = (() => {
    const set = new Set();
    for (const a of agents) {
      const p = Number(a?.port);
      if (Number.isInteger(p) && p > 0) set.add(p);
    }
    for (const p of extraPorts) set.add(p);
    return [...set].sort((x, y) => x - y).join(',');
  })();

  useEffect(() => {
    if (!online) {
      setReadings([]);
      return undefined;
    }
    let cancelled = false;
    const ports = portsKey ? portsKey.split(',').map(Number) : [];

    const tick = async () => {
      try {
        const data = ports.length ? await fetchKvPressure(ports) : [];
        if (cancelled) return;
        setReadings(data);
        setErrored(data.length > 0 && data.every(r => !r.ok));
      } catch (err) {
        console.error('KV pressure poll failed:', err);
        if (!cancelled) setErrored(true);
      }
    };

    tick();
    const id = setInterval(tick, Math.max(1, pollSec) * 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [online, pollSec, portsKey]);

  if (!online) return null;

  const live = readings.filter(r => r.ok);
  if (live.length === 0) {
    if (errored) {
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

  const maxPct = Math.round(Math.max(...live.map(r => r.usage)) * 100);
  const tooltip = live
    .map(r => `:${r.port}${r.backend ? ` (${r.backend})` : ''} ${(r.usage * 100).toFixed(0)}%`)
    .join(' · ');

  return (
    <div className="kv-gauge" title={`KV cache pressure — ${tooltip}`}>
      <span className="kv-gauge-label">KV</span>
      <div className="kv-gauge-track">
        {live.map(r => {
          const pct = Math.round(r.usage * 100);
          return (
            <div
              key={r.port}
              className="kv-gauge-seg"
              style={{ width: `${100 / live.length}%` }}
            >
              <div
                className="kv-gauge-fill"
                style={{ width: `${pct}%`, background: colorFor(pct) }}
              />
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
