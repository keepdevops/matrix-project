import React from 'react';

function basename(p) {
  if (typeof p !== 'string' || !p) return '(unknown)';
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return idx >= 0 ? p.slice(idx + 1) : p;
}

function formatDistance(d) {
  if (typeof d !== 'number' || Number.isNaN(d)) return '—';
  return d.toFixed(4);
}

function RagSources({ rag }) {
  if (!rag || typeof rag !== 'object') return null;
  if (!rag.requested) return null;

  const hits = Array.isArray(rag.hits) ? rag.hits : [];
  const used = !!rag.used;
  const reason = typeof rag.reason === 'string' ? rag.reason : '';

  return (
    <section
      className="final-answer-panel"
      style={{ marginTop: '0.75rem' }}
      aria-label="RAG sources"
    >
      <header className="final-answer-panel__header">
        <span className="final-answer-panel__label">
          RAG SOURCES{hits.length > 0 ? ` (${hits.length})` : ''}
        </span>
      </header>
      {!used && (
        <div style={{ padding: '0.5rem 0.75rem', opacity: 0.8 }}>
          No context retrieved{reason ? `: ${reason}` : '.'}
        </div>
      )}
      {used && hits.length > 0 && (
        <details open style={{ padding: '0.5rem 0.75rem' }}>
          <summary style={{ cursor: 'pointer', userSelect: 'none' }}>
            top_k={rag.top_k ?? '—'} · min_score={rag.min_score ?? '—'}
          </summary>
          <table
            style={{
              width: '100%',
              marginTop: '0.5rem',
              borderCollapse: 'collapse',
              fontSize: '0.85rem',
            }}
          >
            <thead>
              <tr style={{ textAlign: 'left', opacity: 0.7 }}>
                <th style={{ padding: '0.2rem 0.4rem' }}>source</th>
                <th style={{ padding: '0.2rem 0.4rem' }}>chunk</th>
                <th style={{ padding: '0.2rem 0.4rem' }}>distance</th>
              </tr>
            </thead>
            <tbody>
              {hits.map((h, i) => (
                <tr key={`${h.source_path}-${h.chunk_idx}-${i}`}>
                  <td
                    style={{ padding: '0.2rem 0.4rem' }}
                    title={h.source_path || ''}
                  >
                    {basename(h.source_path)}
                  </td>
                  <td style={{ padding: '0.2rem 0.4rem' }}>{h.chunk_idx ?? '—'}</td>
                  <td style={{ padding: '0.2rem 0.4rem' }}>
                    {formatDistance(h.distance)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </section>
  );
}

export default RagSources;
