import { useEffect, useRef, useState } from 'react';
import {
  fetchModels,
  fetchSwarmConfig,
  fetchHostMemory,
} from '../api/swarmApi';
import { useKvPoller } from './useKvPoller';
import { useCoordinatorRefresh } from './useCoordinatorRefresh';

const MEMORY_POLL_MS = 2000;

export function useCoordinatorState(online) {
  const [activeAgents, setActiveAgents] = useState([]);
  const [agentMeta, setAgentMeta]       = useState({});
  const [modes, setModes]               = useState([]);
  const [activeMode, setActiveModeState] = useState(null);
  const { kvReadings, kvFetchFailed }   = useKvPoller(online);
  const [hostMemory, setHostMemory]     = useState(null);
  const [flatPickAgent, setFlatPickAgent] = useState(null);
  const [modeWarnings, setModeWarnings] = useState([]);

  const activeModeRef   = useRef(null);
  const activeAgentsRef = useRef([]);
  const mountedRef      = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  useEffect(() => {
    if (activeMode !== 'flat') setFlatPickAgent(null);
  }, [activeMode]);

  const { refreshModes, refreshAgents, handleModeChange } = useCoordinatorRefresh({
    mountedRef, activeModeRef, activeAgentsRef, agentMeta,
    setActiveAgents, setModes, setActiveModeState, setModeWarnings,
  });

  // Host unified-memory polling (proxy /api/memory — works before coordinator routes).
  useEffect(() => {
    if (!online) { setHostMemory(null); return undefined; }
    let cancelled = false;
    const tick = async () => {
      try {
        const data = await fetchHostMemory();
        if (!cancelled) setHostMemory(data);
      } catch (err) {
        console.error('Host memory poll failed:', err);
        if (!cancelled) setHostMemory({ ok: false, source: 'host' });
      }
    };
    tick();
    const id = setInterval(tick, MEMORY_POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [online]);

  // Refresh agent metadata from swarm config whenever coordinator comes online.
  useEffect(() => {
    if (!online) return;
    Promise.all([fetchSwarmConfig().catch(() => null), fetchModels().catch(() => [])])
      .then(([cfg, models]) => {
        if (!mountedRef.current || !cfg?.agents) return;
        const pathToBackend = Object.fromEntries((models || []).map(m => [m.path, m.backend]));
        const meta = {};
        cfg.agents.forEach(a => {
          meta[a.name] = {
            model:   a.model   || null,
            backend: a.backend || a.engine || pathToBackend[a.model] || null,
          };
        });
        setAgentMeta(meta);
      })
      .catch(err => console.error('Failed to load agent metadata:', err));
  }, [online]);

  // Refresh agents + modes when coordinator comes online.
  useEffect(() => {
    if (online) { refreshModes(); refreshAgents(); }
  }, [online, refreshModes, refreshAgents]);

  return {
    activeAgents, agentMeta, modes, activeMode,
    kvReadings, kvFetchFailed,
    hostMemory, flatPickAgent, setFlatPickAgent,
    modeWarnings, refreshModes, refreshAgents, handleModeChange,
  };
}
