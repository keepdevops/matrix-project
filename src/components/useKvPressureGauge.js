import { useCallback, useEffect, useRef, useState } from 'react';

const TWEEN_MS = 200;

export default function useKvPressureGauge({ online, readings }) {
  const [displayPct, setDisplayPct] = useState(0);
  const tweenRef = useRef({ current: 0, from: 0, to: 0, start: 0, raf: 0 });

  useEffect(() => {
    const t = tweenRef.current;
    return () => { if (t.raf) cancelAnimationFrame(t.raf); };
  }, []);

  const tweenTo = useCallback((target) => {
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
      const eased = 1 - Math.pow(1 - k, 2);
      t.current = t.from + (t.to - t.from) * eased;
      setDisplayPct(t.current);
      if (k < 1) t.raf = requestAnimationFrame(step);
      else t.raf = 0;
    };
    t.raf = requestAnimationFrame(step);
  }, []);

  useEffect(() => {
    if (!online) {
      tweenRef.current.current = 0;
      setDisplayPct(0);
      return;
    }
    const liveFinite = readings.filter(r => r.ok && r.backend !== 'mlx' && Number.isFinite(r.usage));
    if (liveFinite.length > 0) {
      tweenTo(Math.max(...liveFinite.map(r => r.usage)) * 100);
    }
  }, [online, readings, tweenTo]);

  return { displayPct };
}
