import { useState, useCallback, useRef } from 'react';
import { submitPromptStream, fetchHistory, checkHealth } from '../api/swarmApi';

export function useSwarm() {
  const [responses, setResponses] = useState({});
  const [finalAnswer, setFinalAnswer] = useState(null);
  const [lastMeta, setLastMeta] = useState(null);
  const [currentSession, setCurrentSession] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [history, setHistory] = useState([]);
  const [online, setOnline] = useState(false);

  const cancelRef = useRef(null);

  const submit = useCallback((prompt, temperature = 0.7, opts = {}) => {
    // Cancel any in-flight stream before starting a new one.
    if (cancelRef.current) { cancelRef.current(); cancelRef.current = null; }

    setLoading(true);
    setError(null);
    setResponses({});
    setFinalAnswer(null);
    setLastMeta(null);

    const requestOpts = { ...opts };
    if (opts.followup && !requestOpts.sessionId && currentSession?.sessionId) {
      requestOpts.sessionId = currentSession.sessionId;
    }
    if (opts.followup && !requestOpts.parentRunId && currentSession?.runId) {
      requestOpts.parentRunId = currentSession.runId;
    }

    // Accumulate per-agent text locally so the functional setState below
    // never reads stale closure state.
    const assembled = {};

    return new Promise((resolve, reject) => {
      cancelRef.current = submitPromptStream(prompt, temperature, requestOpts, {
        onToken(agent, delta) {
          assembled[agent] = (assembled[agent] || '') + delta;
          // Shallow-clone so React sees a new reference and re-renders.
          setResponses({ ...assembled });
        },
        onAgentDone(agent) {
          // Ensure the final assembled text is committed even if no tokens fired.
          setResponses(prev => (assembled[agent] !== undefined ? { ...prev, [agent]: assembled[agent] } : prev));
        },
        onSelected({ classifier, agents: picked }) {
          // Surface router classifier name in meta for downstream consumers.
          setLastMeta(prev => ({ ...(prev || {}), classifier, selected: picked }));
        },
        onSession({ session_id, run_id }) {
          if (session_id) setCurrentSession({ sessionId: session_id, runId: run_id });
        },
        onDone() {
          setLoading(false);
          cancelRef.current = null;
          const result = { agents: { ...assembled }, final: null, meta: null };
          resolve(result);
        },
        onError(agent, message) {
          console.error('[useSwarm] stream error:', agent, message);
          if (!agent) {
            // Transport-level error — surface to UI.
            setError(message);
            setLoading(false);
            cancelRef.current = null;
            reject(new Error(message));
          }
          // Per-agent errors are non-fatal; other agents may still finish.
        },
      });
    });
  }, [currentSession]);

  const loadHistory = useCallback(async () => {
    try {
      const data = await fetchHistory();
      setHistory(Array.isArray(data) ? data : []);
      setOnline(true);
      return data;
    } catch {
      // Offline is expected before configuration — don't surface as error
      setOnline(false);
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
  };
}

export default useSwarm;
