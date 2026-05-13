import { useState, useCallback } from 'react';
import { submitPrompt, fetchHistory, checkHealth } from '../api/swarmApi';

export function useSwarm() {
  const [responses, setResponses] = useState({});
  const [finalAnswer, setFinalAnswer] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [history, setHistory] = useState([]);
  const [online, setOnline] = useState(false);

  const submit = useCallback(async (prompt, temperature = 0.7, opts = {}) => {
    setLoading(true);
    setError(null);
    setResponses({});
    setFinalAnswer(null);
    try {
      const result = await submitPrompt(prompt, temperature, opts);
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
      return result;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

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
    loading,
    error,
    history,
    online,
    submit,
    loadHistory,
    checkStatus,
    setResponses,
    setFinalAnswer,
  };
}

export default useSwarm;
