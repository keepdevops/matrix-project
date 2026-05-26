import { useEffect } from 'react';

const POLL_INTERVAL_MS = 10000;

/**
 * Polls coordinator status, agents, and modes on a fixed interval.
 * Runs an immediate check on mount, then every 10 seconds while mounted.
 * Agent/mode refresh only fires when the swarm is online.
 */
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkStatus, loadHistory]);
}
