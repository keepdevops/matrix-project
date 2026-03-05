import { useState, useCallback } from 'react';
import { submitPrompt, fetchHistory, checkHealth } from '../api/swarmApi';

/**
 * Custom hook for managing swarm state and actions
 */
export function useSwarm() {
  const [responses, setResponses] = useState({
    logic: null,
    utility: null,
    architect: null,
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
    setResponses({ logic: null, utility: null, architect: null });

    try {
      const result = await submitPrompt(prompt, temperature);
      setResponses({
        logic: result.logic || null,
        utility: result.utility || null,
        architect: result.architect || null,
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
    setResponses({ logic: null, utility: null, architect: null });
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
