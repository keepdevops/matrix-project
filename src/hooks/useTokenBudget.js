import { useState, useEffect, useRef } from 'react';
import { fetchTokenBudget } from '../api/tokenBudgetApi';

const POLL_MS = 2000;

export function useTokenBudget({ sessionId, online }) {
  const [state, setState] = useState({ budget: 0, consumed: 0, remaining: -1, overrun: false });
  const timerRef = useRef(null);

  useEffect(() => {
    if (!online || !sessionId) {
      setState({ budget: 0, consumed: 0, remaining: -1, overrun: false });
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const data = await fetchTokenBudget(sessionId);
        if (!cancelled && data) setState(data);
      } catch (err) {
        console.error('[useTokenBudget] fetch failed:', err);
      }
      if (!cancelled) timerRef.current = setTimeout(poll, POLL_MS);
    };
    poll();
    return () => {
      cancelled = true;
      clearTimeout(timerRef.current);
    };
  }, [sessionId, online]);

  return state;
}
