import React, { createContext, useContext } from 'react';

// Shared swarm-status context: exposes coordinator `online` (from /api/health
// polling in useSwarm) and `checkStatus` so any panel can gate its fetches and
// trigger an immediate health re-check (e.g. right after LAUNCH SWARM) without
// drilling props through SwarmConfig.
const SwarmStatusContext = createContext({
  online: false,
  checkStatus: async () => false,
});

export function SwarmStatusProvider({ value, children }) {
  return (
    <SwarmStatusContext.Provider value={value}>
      {children}
    </SwarmStatusContext.Provider>
  );
}

export function useSwarmStatus() {
  return useContext(SwarmStatusContext);
}

export default SwarmStatusContext;
