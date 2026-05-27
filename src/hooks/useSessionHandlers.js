import { useCallback, useState } from 'react';

const METADATA_KEYS = new Set(['prompt', 'temperature', 'timestamp', '_final', '_mode', '_session_id', '_run_id']);

export function useSessionHandlers({ setResponses, setFinalAnswer, setLastMeta, setCurrentSession, history }) {
  const [showHistory, setShowHistory]               = useState(false);
  const [selectedPrompt, setSelectedPrompt]         = useState(null);
  const [selectedTemperature, setSelectedTemperature] = useState(null);

  const handleHistorySelect = useCallback(entry => {
    const resps = {};
    Object.keys(entry).forEach(k => {
      if (!METADATA_KEYS.has(k)) resps[k] = entry[k] || null;
    });
    setResponses(resps);
    setFinalAnswer(entry._final || null);
    setLastMeta(null);
    if (entry._session_id && entry._run_id) {
      setCurrentSession({ sessionId: entry._session_id, runId: entry._run_id });
    }
    setSelectedPrompt(entry.prompt || '');
    setSelectedTemperature(entry.temperature ?? 0.7);
    setShowHistory(false);
  }, [setResponses, setFinalAnswer, setLastMeta, setCurrentSession]);

  const handleSwitchSession = useCallback((sessionId) => {
    const entries = history.filter(e => e._session_id === sessionId);
    if (!entries.length) return;
    const last = entries[entries.length - 1];
    setCurrentSession({ sessionId, runId: last._run_id });
    setResponses({});
    setFinalAnswer(last._final || null);
    setLastMeta(null);
  }, [history, setCurrentSession, setResponses, setFinalAnswer, setLastMeta]);

  const handleClearSession = useCallback(() => {
    setCurrentSession(null);
    setResponses({});
    setFinalAnswer(null);
    setLastMeta(null);
  }, [setCurrentSession, setResponses, setFinalAnswer, setLastMeta]);

  return {
    showHistory, setShowHistory,
    selectedPrompt, setSelectedPrompt,
    selectedTemperature,
    handleHistorySelect, handleSwitchSession, handleClearSession,
  };
}
