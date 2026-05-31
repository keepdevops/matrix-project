import { useState, useCallback, useEffect, useRef } from 'react';
import { clearMlxSession, fetchHistory, checkHealth } from '../api/swarmApi';
import { runOrchestrateSubmit } from './useSwarmOrchestrateSubmit';
import { runStreamSubmit } from './useSwarmStreamSubmit';

export function useSwarm() {
  const [responses, setResponses] = useState({});
  const [agentErrors, setAgentErrors] = useState({});
  const [finalAnswer, setFinalAnswer] = useState(null);
  const [lastMeta, setLastMeta] = useState(null);
  const [currentSession, setCurrentSession] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [history, setHistory] = useState([]);
  const [online, setOnline] = useState(false);
  const [backend, setBackend] = useState(() =>
    (typeof window !== 'undefined' && localStorage.getItem('swarm.backend')) || 'llama'
  );

  const switchBackend = useCallback((next) => {
    if (next !== 'llama' && next !== 'mlx') return;
    setBackend(next);
    try { localStorage.setItem('swarm.backend', next); } catch (err) {
      console.error('[useSwarm] persist backend failed:', err);
    }
    if (next === 'llama' && currentSession?.sessionId) {
      clearMlxSession(currentSession.sessionId).catch(err =>
        console.error('[useSwarm] mlx session clear failed:', err)
      );
    }
  }, [currentSession]);

  const cancelRef = useRef(null);
  useEffect(() => () => { cancelRef.current?.(); }, []);

  const submit = useCallback((prompt, temperature = 0.7, opts = {}) => {
    if (cancelRef.current) { cancelRef.current(); cancelRef.current = null; }

    setLoading(true);
    setError(null);
    setResponses({});
    setAgentErrors({});
    setFinalAnswer(null);
    setLastMeta(null);

    const wallStart = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    const shared = {
      prompt, opts, wallStart, cancelRef,
      setResponses, setLoading, setError, setFinalAnswer, setLastMeta, setAgentErrors,
    };

    if (opts.orchestrateMode) {
      return runOrchestrateSubmit(shared);
    }

    return runStreamSubmit({
      ...shared, temperature, backend, currentSession, setCurrentSession,
    });
  }, [currentSession, backend]);

  const loadHistory = useCallback(async () => {
    try {
      const data = await fetchHistory();
      setHistory(Array.isArray(data) ? data : []);
      setOnline(true);
      return data;
    } catch (err) {
      console.error('[useSwarm] loadHistory failed:', err);
      return [];
    }
  }, []);

  const checkStatus = useCallback(async () => {
    const isOnline = await checkHealth();
    setOnline(isOnline);
    return isOnline;
  }, []);

  return {
    responses,
    agentErrors,
    finalAnswer,
    lastMeta,
    currentSession,
    loading,
    error,
    history,
    online,
    submit,
    loadHistory,
    checkStatus,
    setResponses,
    setFinalAnswer,
    setLastMeta,
    setCurrentSession,
    backend,
    switchBackend,
  };
}

export default useSwarm;
