import { useState, useCallback, useRef } from 'react';
import { submitPromptStream, submitPromptStreamMlx, clearMlxSession, fetchHistory, checkHealth } from '../api/swarmApi';

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
    // Clear MLX session when switching away so stale cache is freed server-side.
    if (next === 'llama' && currentSession?.sessionId) {
      clearMlxSession(currentSession.sessionId).catch(err =>
        console.error('[useSwarm] mlx session clear failed:', err)
      );
    }
  }, [currentSession]);

  const cancelRef = useRef(null);

  const submit = useCallback((prompt, temperature = 0.7, opts = {}) => {
    // Cancel any in-flight stream before starting a new one.
    if (cancelRef.current) { cancelRef.current(); cancelRef.current = null; }

    setLoading(true);
    setError(null);
    setResponses({});
    setAgentErrors({});
    setFinalAnswer(null);
    setLastMeta(null);

    const requestOpts = { ...opts };
    if (opts.followup && !requestOpts.sessionId && currentSession?.sessionId) {
      requestOpts.sessionId = currentSession.sessionId;
    }
    if (opts.followup && !requestOpts.parentRunId && currentSession?.runId) {
      requestOpts.parentRunId = currentSession.runId;
    }

    // Accumulate per-agent text locally so callbacks never read stale closure state.
    // Tokens arrive as string arrays; join on flush so appends are O(1) not O(n²).
    const assembled = {};

    const streamFn = backend === 'mlx' ? submitPromptStreamMlx : submitPromptStream;

    // RAF-throttle setResponses: flush at most once per animation frame.
    let rafId = null;
    const flushResponses = () => {
      const snapshot = {};
      for (const k of Object.keys(assembled)) snapshot[k] = assembled[k].join('');
      setResponses(snapshot);
      rafId = null;
    };
    const scheduleFlush = () => { if (!rafId) rafId = requestAnimationFrame(flushResponses); };

    return new Promise((resolve, reject) => {
      cancelRef.current = streamFn(prompt, temperature, requestOpts, {
        onToken(agent, delta) {
          if (assembled[agent]) assembled[agent].push(delta);
          else assembled[agent] = [delta];
          scheduleFlush();
        },
        onAgentDone(agent) {
          // Flush immediately so the final text lands without waiting for next frame.
          if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
          flushResponses();
        },
        onSelected({ classifier, agents: picked }) {
          // Surface router classifier name in meta for downstream consumers.
          setLastMeta(prev => ({ ...(prev || {}), classifier, selected: picked }));
        },
        onSession({ session_id, run_id }) {
          if (session_id) setCurrentSession({ sessionId: session_id, runId: run_id });
        },
        onDone() {
          if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
          flushResponses();
          setLoading(false);
          cancelRef.current = null;
          const agents = {};
          for (const k of Object.keys(assembled)) agents[k] = assembled[k].join('');
          resolve({ agents, final: null, meta: null });
        },
        onError(agent, message) {
          console.error('[useSwarm] stream error:', agent, message);
          if (!agent) {
            if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
            setError(message);
            setLoading(false);
            cancelRef.current = null;
            reject(new Error(message));
          } else {
            // Per-agent errors are non-fatal; record for card display.
            setAgentErrors(prev => ({ ...prev, [agent]: message }));
          }
        },
      });
    });
  }, [currentSession, backend]);

  const loadHistory = useCallback(async () => {
    try {
      const data = await fetchHistory();
      setHistory(Array.isArray(data) ? data : []);
      setOnline(true);
      return data;
    } catch (err) {
      // History fetch failing does NOT mean the coordinator is offline — a
      // transient failure mid-stream was clearing kvReadings and hiding the
      // ConversationThread. Online status is managed by checkStatus only.
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
