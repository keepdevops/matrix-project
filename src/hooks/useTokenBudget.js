import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchTokenBudget, resetTokenBudget } from '../api/tokenBudgetApi';

const POLL_MS = 2000;

export function useTokenBudget({ sessionId, online, onOverrun }) {
  const [state, setState] = useState({ budget: 0, consumed: 0, remaining: -1, overrun: false });
  const timerRef = useRef(null);
  const overrunFiredRef = useRef(false);

  useEffect(() => {
    if (!online || !sessionId) {
      setState({ budget: 0, consumed: 0, remaining: -1, overrun: false });
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const data = await fetchTokenBudget(sessionId);
        if (!cancelled && data) {
          setState(data);
          if (data.overrun && !overrunFiredRef.current) {
            overrunFiredRef.current = true;
            onOverrun?.();
          }
          if (!data.overrun) overrunFiredRef.current = false;
        }
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
  }, [sessionId, online, onOverrun]);

  const reset = useCallback(async () => {
    if (!sessionId) return;
    try {
      await resetTokenBudget(sessionId);
      setState({ budget: 0, consumed: 0, remaining: -1, overrun: false });
    } catch (err) {
      console.error('[useTokenBudget] reset failed:', err);
    }
  }, [sessionId]);

  return { ...state, reset };
}
