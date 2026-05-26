import { useEffect, useState } from 'react';
import {
  fetchAgents,
  fetchKvPressure,
  fetchModels,
  fetchSwarmConfig,
  fetchModes,
  setActiveMode,
} from '../api/swarmApi';

const KV_POLL_MS = 250;

export function useCoordinatorState(online) {
  const [activeAgents, setActiveAgents] = useState([]);
  const [agentMeta, setAgentMeta]       = useState({});
  const [modes, setModes]               = useState([]);
  const [activeMode, setActiveModeState] = useState(null);
  const [kvReadings, setKvReadings]     = useState([]);
  const [kvFetchFailed, setKvFetchFailed] = useState(false);
  const [flatPickAgent, setFlatPickAgent] = useState(null);

  useEffect(() => {
    if (activeMode !== 'flat') setFlatPickAgent(null);
  }, [activeMode]);

  const refreshModes = () =>
    fetchModes()
      .then(list => {
        setModes(list);
        const cur = list.find(m => m.active);
        if (cur) setActiveModeState(cur.name);
      })
      .catch(err => console.error('useCoordinatorState: refreshModes failed:', err));

  const refreshAgents = () =>
    fetchAgents()
      .then(agents => {
        const next = agents.map(a => ({
          ...a,
          model:   a.model   || agentMeta[a.name]?.model   || null,
          backend: a.backend || agentMeta[a.name]?.backend || null,
        }));
        // Only update state when the agent list actually changed — avoids
        // creating a new array reference every 10s which re-renders PromptInput
        // and drops keystrokes mid-typing.
        setActiveAgents(prev => {
          if (prev.length === next.length &&
              prev.every((a, i) => a.name === next[i].name && a.backend === next[i].backend))
            return prev;
          return next;
        });
      })
      .catch(err => console.error('useCoordinatorState: refreshAgents failed:', err));

  const handleModeChange = async (name) => {
    try {
      await setActiveMode(name);
      setActiveModeState(name);
      setModes(prev => prev.map(m => ({ ...m, active: m.name === name })));
    } catch (err) {
      console.error('Failed to change mode:', err);
    }
  };

  // KV pressure polling
  useEffect(() => {
    if (!online) {
      setKvReadings([]);
      setKvFetchFailed(false);
      return undefined;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const data = await fetchKvPressure();
        if (cancelled) return;
        setKvReadings(Array.isArray(data) ? data : []);
        setKvFetchFailed(false);
      } catch (err) {
        console.error('KV pressure poll failed:', err);
        if (!cancelled) setKvFetchFailed(true);
      }
    };
    tick();
    const id = setInterval(tick, KV_POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [online]);

  // Load agent metadata from swarm config once on mount
  useEffect(() => {
    Promise.all([fetchSwarmConfig().catch(() => null), fetchModels().catch(() => [])])
      .then(([cfg, models]) => {
        if (!cfg?.agents) return;
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
  }, []);

  // Refresh agents + modes when coordinator comes online
  useEffect(() => {
    if (online) { refreshModes(); refreshAgents(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  return {
    activeAgents,
    agentMeta,
    modes,
    activeMode,
    kvReadings,
    kvFetchFailed,
    flatPickAgent,
    setFlatPickAgent,
    refreshModes,
    refreshAgents,
    handleModeChange,
  };
}
