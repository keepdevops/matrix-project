import { useMemo } from 'react';
import { useSwarm } from './useSwarm';
import { useCoordinatorState } from './useCoordinatorState';
import { useMemoryPressure } from './useMemoryPressure';
import { useAppState } from './useAppState';

export function useAppCoreState({ showToast }) {
  const swarm = useSwarm();
  const {
    responses, agentErrors, finalAnswer, loading, error, history, online,
    submit, loadHistory, checkStatus,
    setResponses, setFinalAnswer, lastMeta, setLastMeta,
    currentSession, setCurrentSession, backend, switchBackend,
  } = swarm;

  const coordinator = useCoordinatorState(online);
  const {
    activeAgents, modes, activeMode, kvReadings, kvFetchFailed, hostMemory,
    flatPickAgent, setFlatPickAgent, modeWarnings, refreshModes, refreshAgents, handleModeChange,
  } = coordinator;

  const warningsByMode = useMemo(
    () => (activeMode && modeWarnings.length > 0 ? { [activeMode]: modeWarnings } : {}),
    [activeMode, modeWarnings]
  );
  const memoryPressure = useMemoryPressure({ online, activeAgents, activeMode, kvReadings, hostMemory });

  const appState = useAppState({ error, showToast, activeMode, modeWarnings, memoryPressure, warningsByMode });

  return {
    responses, agentErrors, finalAnswer, loading, error, history, online,
    submit, loadHistory, checkStatus,
    setResponses, setFinalAnswer, lastMeta, setLastMeta,
    currentSession, setCurrentSession, backend, switchBackend,
    activeAgents, modes, activeMode, kvReadings, kvFetchFailed, hostMemory,
    flatPickAgent, setFlatPickAgent, modeWarnings, refreshModes, refreshAgents, handleModeChange,
    memoryPressure,
    ...appState,
  };
}
