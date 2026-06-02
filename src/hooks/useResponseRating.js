import { useState, useCallback, useEffect } from 'react';
import { submitAnnotation, fetchAnnotation } from '../api/annotationsApi';

export function useResponseRating(runId) {
  const [rating, setRating]   = useState(null);
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);

  useEffect(() => {
    if (!runId) return;
    fetchAnnotation(runId)
      .then(ann => { if (ann) { setRating(ann.rating); setComment(ann.comment || ''); } })
      .catch(() => {});
  }, [runId]);

  const submit = useCallback(async (r) => {
    if (!runId) return;
    const next = rating === r ? null : r; // toggle off if same
    setLoading(true); setError(null);
    try {
      if (next !== null) {
        await submitAnnotation(runId, next, comment);
        setRating(next);
      } else {
        setRating(null);
      }
    } catch (err) {
      console.error('[useResponseRating]', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [runId, rating, comment]);

  return { rating, comment, setComment, submit, loading, error };
}
