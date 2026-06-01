import { useState, useEffect, useRef } from 'react';
import { searchHistory } from '../api/historyApi';

const DEBOUNCE_MS = 300;

export function useHistorySearch() {
  const [query, setQuery]     = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);
  const timerRef = useRef(null);

  useEffect(() => {
    clearTimeout(timerRef.current);
    if (!query.trim()) { setResults([]); setError(null); return; }
    setLoading(true);
    timerRef.current = setTimeout(async () => {
      try {
        const data = await searchHistory(query.trim());
        setResults(Array.isArray(data) ? data : []);
        setError(null);
      } catch (err) {
        console.error('[useHistorySearch] search failed:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timerRef.current);
  }, [query]);

  return { query, setQuery, results, loading, error };
}
