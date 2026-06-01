import { useCallback } from 'react';
import { submitPromptStream, submitPromptStreamMlx } from '../api/swarmApi';
import { createRafResponseAccumulator, runOrchestrateStream } from './useOrchestrateStream';

export function useSwarmSubmit({
  currentSession, backend, cancelRef,
  setLoading, setError, setResponses, setAgentErrors,
  setFinalAnswer, setLastMeta, setCurrentSession,
}) {
  const submit = useCallback((prompt, temperature = 0.7, opts = {}) => {
    if (cancelRef.current) { cancelRef.current(); cancelRef.current = null; }

    setLoading(true);
    setError(null);
    setResponses({});
    setAgentErrors({});
    setFinalAnswer(null);
    setLastMeta(null);

    const wallStart = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

    if (opts.orchestrateMode) {
      return runOrchestrateStream({
        prompt,
        orchestrateMode: opts.orchestrateMode,
        orchestrateParams: opts.orchestrateParams,
        ragOpts: { useRag: opts.useRag, ragTopK: opts.ragTopK, ragMinScore: opts.ragMinScore },
        wallStart,
        cancelRef,
        setResponses, setAgentErrors, setFinalAnswer, setLastMeta, setLoading, setError,
      });
    }

    const requestOpts = { ...opts };
    if (opts.followup && !requestOpts.sessionId && currentSession?.sessionId) {
      requestOpts.sessionId = currentSession.sessionId;
    }
    if (opts.followup && !requestOpts.parentRunId && currentSession?.runId) {
      requestOpts.parentRunId = currentSession.runId;
    }

    const { assembled, scheduleFlush, flushNow, cancelFlush } =
      createRafResponseAccumulator(setResponses);

    const streamFn = backend === 'mlx' ? submitPromptStreamMlx : submitPromptStream;

    return new Promise((resolve, reject) => {
      cancelRef.current = streamFn(prompt, temperature, requestOpts, {
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
      });
    });
  }, [currentSession, backend, cancelRef,
      setLoading, setError, setResponses, setAgentErrors,
      setFinalAnswer, setLastMeta, setCurrentSession]);

  return { submit };
}
