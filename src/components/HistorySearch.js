import React from 'react';
import { useHistorySearch } from '../hooks/useHistorySearch';
import ForkButton from './ForkButton';

function truncate(s, n) {
  if (typeof s !== 'string') return '';
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function formatTs(ts) {
  if (!ts) return '';
  try { return new Date(ts).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }); }
  catch { return ''; }
}

export default function HistorySearch({ onSelect, onForked }) {
  const { query, setQuery, results, loading, error } = useHistorySearch();

  return (
    <div className="history-search" style={{ fontSize: '0.78rem' }}>
      <input
        type="search"
        placeholder="Search history…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{ width: '100%', padding: '0.3rem 0.5rem', marginBottom: '0.4rem',
                 fontSize: '0.78rem', boxSizing: 'border-box' }}
      />
      {loading && <div style={{ opacity: 0.5 }}>Searching…</div>}
      {error && <div style={{ color: 'var(--color-danger, #ef4444)' }}>{error}</div>}
      {!loading && results.length === 0 && query.trim() && (
        <div style={{ opacity: 0.5 }}>No results</div>
      )}
      <div className="history-search-results">
        {results.map((entry, i) => (
          <div key={entry._run_id || i}
               className="history-search-row"
               style={{ padding: '0.3rem 0.4rem',
                        borderBottom: '1px solid var(--border-dim, #1a1a1a)',
                        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ flex: 1, cursor: 'pointer' }} onClick={() => onSelect?.(entry)}>
              <div style={{ fontWeight: 500 }}>{truncate(entry.prompt, 80)}</div>
              <div style={{ opacity: 0.5, fontSize: '0.7rem', marginTop: '0.1rem' }}>
                {formatTs(entry.timestamp)}
                {entry._session_id && (
                  <span style={{ marginLeft: '0.5rem', opacity: 0.7 }}>
                    {String(entry._session_id).slice(0, 8)}
                  </span>
                )}
              </div>
            </div>
            <ForkButton runId={entry._run_id} onForked={onForked}
                        style={{ marginLeft: '0.5rem', flexShrink: 0 }} />
          </div>
        ))}
      </div>
    </div>
  );
}
