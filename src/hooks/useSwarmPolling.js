import { useEffect } from 'react';

const POLL_INTERVAL_MS = 10000;

export function useSwarmPolling({ checkStatus, loadHistory, refreshAgents, refreshModes, online }) {
  useEffect(() => {
    checkStatus();
    loadHistory();
    refreshAgents();
    refreshModes();
    const interval = setInterval(() => {
      checkStatus();
      if (online) { refreshAgents(); refreshModes(); }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [checkStatus, loadHistory, online, refreshAgents, refreshModes]);

  useEffect(() => {
    if (online) loadHistory();
  }, [online, loadHistory]);
}
