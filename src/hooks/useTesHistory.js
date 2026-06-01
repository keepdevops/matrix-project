import { useState, useCallback } from 'react';

const MAX_HISTORY = 5;

export function useTesHistory() {
  const [history, setHistory] = useState([]);

  const record = useCallback((tes) => {
    if (typeof tes !== 'number' || tes <= 0) return;
    setHistory(prev => {
      const next = [...prev, tes];
      return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
    });
  }, []);

  const avg = history.length > 0
    ? history.reduce((s, v) => s + v, 0) / history.length
    : 0;

  return { history, avg, record };
}
