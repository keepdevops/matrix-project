export function buildStreamCallbacks({
  assembled, scheduleFlush, flushNow, cancelFlush,
  cancelRef, wallStart,
  setResponses, setAgentErrors, setFinalAnswer,
  setLastMeta, setLoading, setError, setCurrentSession,
  onTes,
  resolve, reject,
}) {
  return {
    onToken(agent, delta) {
      if (assembled[agent]) assembled[agent].push(delta);
      else assembled[agent] = [delta];
      scheduleFlush();
    },
    onAgentDone(agent) {
      flushNow();
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
      const timings = (data?.timings && typeof data.timings === 'object') ? data.timings : data;
      const wallMs = (typeof performance !== 'undefined' && performance.now)
        ? performance.now() - wallStart : Date.now() - wallStart;
      setLastMeta(prev => ({ ...(prev || {}), timings, wall_ms: wallMs }));
    },
    onRouting(data) {  // MS-161 Phase C: surface streamed backend-routing decisions
      if (data && typeof data === 'object') setLastMeta(prev => ({ ...(prev || {}), routing: data }));
    },
    onTes(tes) {  // MS-72: stream TES into sparkline history
      onTes?.(tes);
    },
    onSelected({ classifier, agents: picked }) {
      setLastMeta(prev => ({ ...(prev || {}), classifier, selected: picked }));
    },
    onSession({ session_id, run_id }) {
      if (session_id) setCurrentSession({ sessionId: session_id, runId: run_id });
    },
    onDone() {
      flushNow();
      setLoading(false);
      cancelRef.current = null;
      const agents = {};
      for (const k of Object.keys(assembled)) agents[k] = assembled[k].join('');
      resolve({ agents, final: null, meta: null });
    },
    onError(agent, message) {
      console.error('[useSwarm] stream error:', agent, message);
      if (!agent) {
        cancelFlush();
        setError(message);
        setLoading(false);
        cancelRef.current = null;
        reject(new Error(message));
      } else {
        setAgentErrors(prev => ({ ...prev, [agent]: message }));
      }
    },
  };
}
