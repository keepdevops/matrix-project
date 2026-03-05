import { useState, useCallback } from 'react';
import { submitPrompt, fetchHistory, checkHealth } from '../api/swarmApi';

/**
 * Custom hook for managing swarm state and actions
 */
export function useSwarm() {
  const [responses, setResponses] = useState({
    architect: null,
    specialist: null,
    scout: null,
    programmer: null,
    synthesis: null,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [history, setHistory] = useState([]);
  const [online, setOnline] = useState(false);

  /**
   * Submit a prompt to the swarm coordinator
   */
  const submit = useCallback(async (prompt, temperature = 0.7) => {
    setLoading(true);
    setError(null);
    setResponses({ architect: null, specialist: null, scout: null, programmer: null, synthesis: null });

    try {
      const result = await submitPrompt(prompt, temperature);
      setResponses({
        architect: result.architect || null,
        specialist: result.specialist || null,
        scout: result.scout || null,
        programmer: result.programmer || null,
        synthesis: result.synthesis || null,
      });
      return result;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Load history from the coordinator
   */
  const loadHistory = useCallback(async () => {
    try {
      const data = await fetchHistory();
      setHistory(Array.isArray(data) ? data : []);
      setOnline(true);
      return data;
    } catch (err) {
      setError(err.message);
      setOnline(false);
      return [];
    }
  }, []);

  /**
   * Check coordinator health status
   */
  const checkStatus = useCallback(async () => {
    const isOnline = await checkHealth();
    setOnline(isOnline);
    return isOnline;
  }, []);

  /**
   * Clear current responses
   */
  const clearResponses = useCallback(() => {
    setResponses({ architect: null, specialist: null, scout: null, programmer: null, synthesis: null });
    setError(null);
  }, []);

  return {
    // State
    responses,
    loading,
    error,
    history,
    online,
    // Actions
    submit,
    loadHistory,
    checkStatus,
    clearResponses,
    setResponses,
  };
}

export default useSwarm;
