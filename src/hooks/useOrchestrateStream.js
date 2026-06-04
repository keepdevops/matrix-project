import { submitOrchestrateStream, saveOrchestrateHistory } from '../api/orchestrateApi';
import { useTesHistory } from './useTesHistory';

/** RAF-throttled per-agent token accumulator for SSE streams. */
export function createRafResponseAccumulator(setResponses) {
  const assembled = {};
  let rafId = null;

  const flushResponses = () => {
    const snapshot = {};
    for (const k of Object.keys(assembled)) snapshot[k] = assembled[k].join('');
    setResponses(snapshot);
    rafId = null;
  };
  const scheduleFlush = () => {
    if (!rafId) rafId = requestAnimationFrame(flushResponses);
  };
  const cancelFlush = () => {
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  };
  const flushNow = () => {
    cancelFlush();
    flushResponses();
  };

  return { assembled, scheduleFlush, flushNow, cancelFlush };
}

/**
 * Python-mode orchestrate SSE path — assembles per-agent tokens, sets final
 * answer/meta, persists history. Returns a Promise resolved on stream done.
 */
export function useRunOrchestrateStream() {
  const { record: recordTes } = useTesHistory();
  return (opts) => runOrchestrateStream({ ...opts, onTes: recordTes });
}

export function runOrchestrateStream({
  prompt,
  orchestrateMode,
  orchestrateParams = {},
  ragOpts = {},
  wallStart,
  cancelRef,
  setResponses,
  setAgentErrors,
  setFinalAnswer,
  setLastMeta,
  setLoading,
  setError,
  onTes,
}) {
  const { assembled, scheduleFlush, flushNow, cancelFlush } =
    createRafResponseAccumulator(setResponses);

  return new Promise((resolve, reject) => {
    cancelRef.current = submitOrchestrateStream(
      orchestrateMode,
      prompt,
      orchestrateParams,
      ragOpts,
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
          flushNow();
        },
        onDone(data) {
          flushNow();
          if (typeof data?.meta?.tes === 'number') onTes?.(data.meta.tes);
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
            mode: orchestrateMode, ...(data?.meta || {}),
            wall_ms: Date.now() - wallStart,
            ...(ragMeta ? { rag: ragMeta } : {}),
          });
          setLoading(false);
          cancelRef.current = null;
          saveOrchestrateHistory({
            prompt,
            result: resultText || '',
            mode: orchestrateMode,
            sessionId: data?.session_id || '',
          }).catch(() => {});
          resolve({ final: resultText, meta: data?.meta });
        },
        onError(agentId, message) {
          console.error('[useOrchestrateStream] error:', agentId, message);
          if (!agentId) {
            cancelFlush();
            setError(message);
            setLoading(false);
            cancelRef.current = null;
            reject(new Error(message));
          } else {
            setAgentErrors(prev => ({ ...prev, [agentId]: message }));
          }
        },
      },
    );
  });
}
