import React, { useState } from 'react';
import { useResponseRating } from '../hooks/useResponseRating';

export default function ResponseRating({ runId }) {
  const { rating, comment, setComment, submit, loading } = useResponseRating(runId);
  const [showComment, setShowComment] = useState(false);

  if (!runId) return null;

  const btnStyle = (active) => ({
    fontSize: '0.78rem', padding: '0 0.3rem', cursor: 'pointer',
    background: active ? 'var(--color-primary, #4a9eff)' : 'none',
    color: active ? '#fff' : undefined,
    border: '1px solid currentColor', borderRadius: 3,
    opacity: loading ? 0.5 : 0.75, lineHeight: 1.4,
  });

  const handleRate = (r) => {
    submit(r);
    setShowComment(true);
  };

  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: '0.2rem' }}>
      <span style={{ display: 'inline-flex', gap: '0.25rem', alignItems: 'center' }}>
        <button style={btnStyle(rating === 1)} onClick={() => handleRate(1)}
                disabled={loading} title="Helpful">▲</button>
        <button style={btnStyle(rating === -1)} onClick={() => handleRate(-1)}
                disabled={loading} title="Not helpful">▼</button>
        {rating != null && !showComment && (
          <button style={{ ...btnStyle(false), opacity: 0.5 }}
                  onClick={() => setShowComment(true)} title="Add comment">✎</button>
        )}
      </span>
      {showComment && rating != null && (
        <span style={{ display: 'inline-flex', gap: '0.2rem' }}>
          <input value={comment} onChange={e => setComment(e.target.value)}
                 placeholder="Comment (optional)"
                 style={{ fontSize: '0.72rem', padding: '0.1rem 0.25rem', width: '10rem' }}
                 onKeyDown={e => { if (e.key === 'Enter') { submit(rating); setShowComment(false); } }} />
          <button style={btnStyle(false)} onClick={() => { submit(rating); setShowComment(false); }}>✓</button>
        </span>
      )}
    </span>
  );
}
