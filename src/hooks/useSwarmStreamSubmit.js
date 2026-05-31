import { submitPromptStream, submitPromptStreamMlx } from '../api/swarmApi';

/** Llama or MLX architect SSE submit with RAF-throttled token flush. */
export function runStreamSubmit({
  prompt, temperature, opts, backend, currentSession, wallStart, cancelRef,
  setResponses, setLoading, setError, setAgentErrors, setLastMeta, setCurrentSession,
}) {
  const requestOpts = { ...opts };
  if (opts.followup && !requestOpts.sessionId && currentSession?.sessionId) {
    requestOpts.sessionId = currentSession.sessionId;
  }
  if (opts.followup && !requestOpts.parentRunId && currentSession?.runId) {
    requestOpts.parentRunId = currentSession.runId;
  }

  const assembled = {};
  const streamFn = backend === 'mlx' ? submitPromptStreamMlx : submitPromptStream;

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
          setAgentErrors(prev => ({ ...prev, [agent]: message }));
        }
      },
    });
  });
}
