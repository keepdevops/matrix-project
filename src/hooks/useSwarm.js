import { useState, useCallback, useEffect, useRef } from 'react';
import { submitPromptStream, submitPromptStreamMlx, clearMlxSession, fetchHistory, checkHealth, submitOrchestrateStream, saveOrchestrateHistory } from '../api/swarmApi';

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
  useEffect(() => () => { cancelRef.current?.(); }, []);

  const submit = useCallback((prompt, temperature = 0.7, opts = {}) => {
    // Cancel any in-flight stream before starting a new one.
    if (cancelRef.current) { cancelRef.current(); cancelRef.current = null; }

    setLoading(true);
    setError(null);
    setResponses({});
    setAgentErrors({});
    setFinalAnswer(null);
    setLastMeta(null);

    const wallStart = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

    // Python-mode orchestrate path — SSE streaming.
    if (opts.orchestrateMode) {
      const ragOpts = { useRag: opts.useRag, ragTopK: opts.ragTopK, ragMinScore: opts.ragMinScore };
      return new Promise((resolve, reject) => {
        cancelRef.current = submitOrchestrateStream(
          opts.orchestrateMode, prompt, opts.orchestrateParams || {}, ragOpts,
          {
            onToken(agentId, text) {
              if (assembled[agentId]) assembled[agentId].push(text);
              else assembled[agentId] = [text];
              scheduleFlush();
            },
            onAgentStart(agentId, eventMeta) {
              setLastMeta(prev => ({ ...(prev || {}), _phase: { agent: agentId, ...eventMeta } }));
            },
            onAgentDone() {
              if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
              flushResponses();
            },
            onDone(data) {
              if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
              flushResponses();
              const resultText = data?.result
                || Object.values(assembled).map(a => a.join('')).join('');
              setFinalAnswer(resultText || null);
              const ragChunks = data?.meta?.rag_chunks;
              const ragMeta = Array.isArray(ragChunks) && ragChunks.length > 0 ? {
                requested: true, used: true, top_k: ragChunks.length,
                hits: ragChunks.map((c, i) => ({
                  source_path: c.source_path, chunk_idx: i,
                  distance: c.distance, content: c.content,
                })),
              } : null;
              setLastMeta({
                mode: opts.orchestrateMode, ...(data?.meta || {}),
                wall_ms: Date.now() - wallStart,
                ...(ragMeta ? { rag: ragMeta } : {}),
              });
              setLoading(false);
              cancelRef.current = null;
              saveOrchestrateHistory({
                prompt,
                result: resultText || '',
                mode: opts.orchestrateMode,
                sessionId: data?.session_id || '',
              }).catch(() => {});
              resolve({ final: resultText, meta: data?.meta });
            },
            onError(agentId, message) {
              console.error('[useSwarm] orchestrate stream error:', agentId, message);
              if (!agentId) {
                if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
                setError(message);
                setLoading(false);
                cancelRef.current = null;
                reject(new Error(message));
              } else {
                setAgentErrors(prev => ({ ...prev, [agentId]: message }));
              }
            },
          }
        );
      });
    }

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
          const text = assembled[agent]?.join('') || '';
          if (text) {
            setLastMeta(prev => {
              if (!prev?.stage_outputs?.length) return prev;
              return {
                ...prev,
                stage_outputs: prev.stage_outputs.map((s) => (
                  s.agent === agent ? { ...s, output: text } : s
                )),
              };
            });
          }
        },
        onStage(data) {
          if (!data?.agent) return;
          setLastMeta(prev => ({
            ...(prev || {}),
            stage_outputs: [
              ...(prev?.stage_outputs || []),
              { step: data.step, agent: data.agent, output: '' },
            ],
          }));
        },
        onMetrics(data) {
          const timings = (data?.timings && typeof data.timings === 'object')
            ? data.timings
            : data;
          const wallMs = (typeof performance !== 'undefined' && performance.now)
            ? performance.now() - wallStart
            : Date.now() - wallStart;
          setLastMeta(prev => ({ ...(prev || {}), timings, wall_ms: wallMs }));
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
