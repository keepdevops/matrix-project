import { useState, useCallback } from 'react';
import { submitPrompt, fetchHistory, checkHealth } from '../api/swarmApi';

export function useSwarm() {
  const [responses, setResponses] = useState({});
  const [finalAnswer, setFinalAnswer] = useState(null);
  const [lastMeta, setLastMeta] = useState(null);
  const [currentSession, setCurrentSession] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [history, setHistory] = useState([]);
  const [online, setOnline] = useState(false);

  const submit = useCallback(async (prompt, temperature = 0.7, opts = {}) => {
    setLoading(true);
    setError(null);
    setResponses({});
    setFinalAnswer(null);
    setLastMeta(null);
    try {
      const requestOpts = { ...opts };
      if (opts.followup && !requestOpts.sessionId && currentSession?.sessionId) {
        requestOpts.sessionId = currentSession.sessionId;
      }
      if (opts.followup && !requestOpts.parentRunId && currentSession?.runId) {
        requestOpts.parentRunId = currentSession.runId;
      }
      const result = await submitPrompt(prompt, temperature, requestOpts);
      // submitPrompt returns { mode, agents, final, meta }; store the flat
      // agents map so existing consumers (AgentGrid, handleSaveCode, history
      // selection) keep seeing the same shape as before.
      const merged = { ...(result.agents || {}) };
      // In router mode the classifier (e.g. foreman) doesn't appear in
      // `agents` because it didn't answer the user prompt — it produced the
      // routing plan. Surface that plan under the classifier's tile so the
      // user can see why the selected agents were chosen.
      const classifier = result?.meta?.classifier;
      const classifierRaw = result?.meta?.classifier_raw;
      if (classifier && classifierRaw && merged[classifier] == null) {
        merged[classifier] = classifierRaw;
      }
      setResponses(merged);
      setFinalAnswer(result.final || null);
      setLastMeta(result.meta || null);
      if (result?.meta?.session_id && result?.meta?.run_id) {
        setCurrentSession({
          sessionId: result.meta.session_id,
          runId: result.meta.run_id,
        });
      }
      return result;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
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
