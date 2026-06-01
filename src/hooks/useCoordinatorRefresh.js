import { useCallback } from 'react';
import { fetchAgents, fetchModes, setActiveMode } from '../api/swarmApi';
import { fetchModeAgents } from '../api/modesApi';
import { computeModeReadiness } from '../utils/modeReadiness';
import { applyModeManifest } from '../utils/modeManifest';

/**
 * Refresh callbacks for coordinator modes and agents.
 * Extracted from useCoordinatorState to keep that hook under 130 LOC.
 */
export function useCoordinatorRefresh({
  mountedRef,
  activeModeRef,
  activeAgentsRef,
  agentMeta,
  setActiveAgents,
  setModes,
  setActiveModeState,
  setModeWarnings,
}) {
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
  }, [mountedRef, activeModeRef, activeAgentsRef, setModeWarnings]);

  const refreshModes = useCallback(() =>
    fetchModes()
      .then(list => {
        if (!mountedRef.current) return;
        const filtered = applyModeManifest(list);
        const cur = filtered.find(m => m.active) || list.find(m => m.active);
        setModes(filtered);
        if (cur) {
          setActiveModeState(cur.name);
          activeModeRef.current = cur.name;
          refreshModeReadiness(cur.name, null);
        }
      })
      .catch(err => console.error('useCoordinatorState: refreshModes failed:', err)),
  [mountedRef, activeModeRef, setModes, setActiveModeState, refreshModeReadiness]);

  const refreshAgents = useCallback(() =>
    fetchAgents()
      .then(agents => {
        if (!mountedRef.current) return;
        const next = agents.map(a => ({
          ...a,
          model:   a.model   || agentMeta[a.name]?.model   || null,
          backend: a.backend || agentMeta[a.name]?.backend || null,
        }));
        // Only update when agent list actually changed — avoids re-rendering
        // PromptInput on every poll and dropping keystrokes mid-typing.
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
  [mountedRef, activeAgentsRef, agentMeta, setActiveAgents, refreshModeReadiness]);

  const handleModeChange = useCallback(async (name) => {
    try {
      await setActiveMode(name);
      setActiveModeState(name);
      activeModeRef.current = name;
      setModes(prev => prev.map(m => ({ ...m, active: m.name === name })));
      refreshModeReadiness(name, null);
    } catch (err) {
      console.error('Failed to change mode:', err);
    }
  }, [activeModeRef, setActiveModeState, setModes, refreshModeReadiness]);

  return { refreshModeReadiness, refreshModes, refreshAgents, handleModeChange };
}
