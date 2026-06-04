import { useCallback } from 'react';
import { submitPromptStream, submitPromptStreamMlx } from '../api/swarmApi';
import { createRafResponseAccumulator, runOrchestrateStream } from './useOrchestrateStream';
import { buildStreamCallbacks } from './useSwarmSubmit.stream';

export function useSwarmSubmit({
  currentSession, backend, cancelRef,
  setLoading, setError, setResponses, setAgentErrors,
  setFinalAnswer, setLastMeta, setCurrentSession,
  onTes,
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
    if (opts.followup && !requestOpts.sessionId && currentSession?.sessionId)
      requestOpts.sessionId = currentSession.sessionId;
    if (opts.followup && !requestOpts.parentRunId && currentSession?.runId)
      requestOpts.parentRunId = currentSession.runId;

    const { assembled, scheduleFlush, flushNow, cancelFlush } =
      createRafResponseAccumulator(setResponses);

    const streamFn = backend === 'mlx' ? submitPromptStreamMlx : submitPromptStream;

    return new Promise((resolve, reject) => {
      cancelRef.current = streamFn(prompt, temperature, requestOpts,
        buildStreamCallbacks({
          assembled, scheduleFlush, flushNow, cancelFlush,
          cancelRef, wallStart,
          setResponses, setAgentErrors, setFinalAnswer,
          setLastMeta, setLoading, setError, setCurrentSession,
          onTes,
          resolve, reject,
        }),
      );
    });
  }, [currentSession, backend, cancelRef,
      setLoading, setError, setResponses, setAgentErrors,
      setFinalAnswer, setLastMeta, setCurrentSession, onTes]);

  return { submit };
}
