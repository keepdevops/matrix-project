import React, { useEffect, useRef, useState } from 'react';
import { fetchKvPressure } from '../api/swarmApi';

const POLL_MS = 250;
const TWEEN_MS = 200; // settle before the next sample arrives

function colorFor(pct) {
  if (pct >= 90) return 'var(--kv-crit, #ff4136)';
  if (pct >= 70) return 'var(--kv-warn, #ffae00)';
  return 'var(--kv-ok, #00ff41)';
}

export default function KvPressureGauge({ online }) {
  const [readings, setReadings] = useState([]);
  const [errored, setErrored] = useState(false);
  const [displayPct, setDisplayPct] = useState(0);
  // current = last value actually painted; used as the "from" anchor so a new
  // sample arriving mid-tween picks up where we are, not where we started.
  const tweenRef = useRef({ current: 0, from: 0, to: 0, start: 0, raf: 0 });

  useEffect(() => {
    const t = tweenRef.current;
    return () => { if (t.raf) cancelAnimationFrame(t.raf); };
  }, []);

  const tweenTo = (target) => {
    const t = tweenRef.current;
    // Guard against non-finite samples (e.g. transient 0/0 from a freshly
    // cleared KV cache). Without this, NaN/Infinity poisons t.current and
    // every subsequent tween stays NaN forever.
    const safeTarget = Number.isFinite(target)
      ? Math.max(0, Math.min(100, target))
      : 0;
    if (!Number.isFinite(t.current)) t.current = 0;
    if (t.raf) cancelAnimationFrame(t.raf);
    t.from = t.current;
    t.to = safeTarget;
    t.start = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - t.start) / TWEEN_MS);
      const eased = 1 - Math.pow(1 - k, 2); // ease-out quad — quicker initial jump
      t.current = t.from + (t.to - t.from) * eased;
      setDisplayPct(t.current);
      if (k < 1) t.raf = requestAnimationFrame(step);
      else t.raf = 0;
    };
    t.raf = requestAnimationFrame(step);
  };

  useEffect(() => {
    if (!online) {
      setReadings([]);
      tweenRef.current.current = 0;
      setDisplayPct(0);
      return undefined;
    }
    let cancelled = false;

    const tick = async () => {
      try {
        const data = await fetchKvPressure();
        if (cancelled) return;
        setReadings(data);
        const live = data.filter(r => r.ok && Number.isFinite(r.usage));
        setErrored(live.length === 0 && data.length > 0);
        if (live.length > 0) {
          const target = Math.max(...live.map(r => r.usage)) * 100;
          tweenTo(target);
        }
      } catch (err) {
        console.error('KV pressure poll failed:', err);
        if (!cancelled) setErrored(true);
      }
    };

    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [online]);

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

  const maxPct = Math.round(displayPct);
  const tooltip = live
    .map(r => {
      const pct = (r.usage * 100).toFixed(0);
      const tokens = (r.kv_used != null && r.kv_total != null)
        ? ` ${r.kv_used}/${r.kv_total}` : '';
      const slots = (r.slots_total)
        ? ` busy ${r.slots_busy ?? 0}/${r.slots_total}` : '';
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
