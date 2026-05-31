import { submitOrchestrateStream, saveOrchestrateHistory } from '../api/swarmApi';

/** Python orchestrate-mode SSE submit (map_reduce, critic_debate, etc.). */
export function runOrchestrateSubmit({
  prompt, opts, wallStart, cancelRef,
  setResponses, setLoading, setError, setFinalAnswer, setLastMeta, setAgentErrors,
}) {
  const ragOpts = { useRag: opts.useRag, ragTopK: opts.ragTopK, ragMinScore: opts.ragMinScore };
  const assembled = {};
  let rafId = null;

  const flushResponses = () => {
    const snapshot = {};
    for (const k of Object.keys(assembled)) snapshot[k] = assembled[k].join('');
    setResponses(snapshot);
    rafId = null;
  };
  const scheduleFlush = () => { if (!rafId) rafId = requestAnimationFrame(flushResponses); };

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
