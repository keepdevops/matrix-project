import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchAgents,
  fetchKvPressure,
  fetchModels,
  fetchSwarmConfig,
  fetchModes,
  setActiveMode,
} from '../api/swarmApi';
import { fetchModeAgents } from '../api/agentsApi';
import { computeModeReadiness } from '../utils/modeReadiness';

const KV_POLL_MS = 250;

export function useCoordinatorState(online) {
  const [activeAgents, setActiveAgents] = useState([]);
  const [agentMeta, setAgentMeta]       = useState({});
  const [modes, setModes]               = useState([]);
  const [activeMode, setActiveModeState] = useState(null);
  const [kvReadings, setKvReadings]     = useState([]);
  const [kvFetchFailed, setKvFetchFailed] = useState(false);
  const [flatPickAgent, setFlatPickAgent] = useState(null);
  const [modeWarnings, setModeWarnings] = useState([]);

  // Refs to hold latest agents/mode for the readiness check without triggering
  // re-renders or stale closures in the refresh callbacks.
  const activeModeRef  = useRef(null);
  const activeAgentsRef = useRef([]);
  // Prevents state updates after unmount (avoids dangling React scheduler work).
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  useEffect(() => {
    if (activeMode !== 'flat') setFlatPickAgent(null);
  }, [activeMode]);

  const refreshModeReadiness = useCallback((modeName, agents) => {
    const name = modeName ?? activeModeRef.current;
    const liveNames = (agents ?? activeAgentsRef.current).map(a => a.name);
    if (!name) return;
    fetchModeAgents(name)
      .then(cfg => {
        if (!mountedRef.current) return;
        const { warnings } = computeModeReadiness(name, cfg, liveNames);
        setModeWarnings(warnings);
      })
      .catch(err => console.error('useCoordinatorState: refreshModeReadiness failed:', err));
  }, []);

  const refreshModes = useCallback(() =>
    fetchModes()
      .then(list => {
        if (!mountedRef.current) return;
        const cur = list.find(m => m.active);
        setModes(list);
        if (cur) {
          setActiveModeState(cur.name);
          activeModeRef.current = cur.name;
          refreshModeReadiness(cur.name, null);
        }
      })
      .catch(err => console.error('useCoordinatorState: refreshModes failed:', err)),
  [refreshModeReadiness]);

  const refreshAgents = useCallback(() =>
    fetchAgents()
      .then(agents => {
        if (!mountedRef.current) return;
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
          activeAgentsRef.current = next;
          refreshModeReadiness(null, next);
          return next;
        });
      })
      .catch(err => console.error('useCoordinatorState: refreshAgents failed:', err)),
  [agentMeta, refreshModeReadiness]);

  const handleModeChange = async (name) => {
    try {
      await setActiveMode(name);
      setActiveModeState(name);
      activeModeRef.current = name;
      setModes(prev => prev.map(m => ({ ...m, active: m.name === name })));
      refreshModeReadiness(name, null);
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
  }, []);

  // Refresh agents + modes when coordinator comes online
  useEffect(() => {
    if (online) { refreshModes(); refreshAgents(); }
  }, [online, refreshModes, refreshAgents]);

  return {
    activeAgents,
    agentMeta,
    modes,
    activeMode,
    kvReadings,
    kvFetchFailed,
    flatPickAgent,
    setFlatPickAgent,
    modeWarnings,
    refreshModes,
    refreshAgents,
    handleModeChange,
  };
}
