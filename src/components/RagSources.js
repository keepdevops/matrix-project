import React, { useState } from 'react';

function basename(p) {
  if (typeof p !== 'string' || !p) return '(unknown)';
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return idx >= 0 ? p.slice(idx + 1) : p;
}

function formatDistance(d) {
  if (typeof d !== 'number' || Number.isNaN(d)) return '—';
  return d.toFixed(4);
}

function HitRow({ h, i }) {
  const [expanded, setExpanded] = useState(false);
  const hasContent = typeof h.content === 'string' && h.content.trim().length > 0;

  return (
    <>
      <tr
        key={`${h.source_path}-${h.chunk_idx}-${i}`}
        style={{ cursor: hasContent ? 'pointer' : 'default' }}
        onClick={() => hasContent && setExpanded(v => !v)}
        title={hasContent ? (expanded ? 'Collapse chunk' : 'Expand chunk') : h.source_path || ''}
      >
        <td style={{ padding: '0.2rem 0.4rem' }} title={h.source_path || ''}>
          {hasContent && (
            <span style={{ marginRight: 5, fontSize: '0.7rem', opacity: 0.6 }}>
              {expanded ? '▼' : '▶'}
            </span>
          )}
          {basename(h.source_path)}
        </td>
        <td style={{ padding: '0.2rem 0.4rem' }}>{h.chunk_idx ?? '—'}</td>
        <td style={{ padding: '0.2rem 0.4rem' }}>{formatDistance(h.distance)}</td>
      </tr>
      {expanded && hasContent && (
        <tr>
          <td colSpan={3} style={{ padding: '0 0.4rem 0.5rem' }}>
            <pre style={{
              margin: 0,
              padding: '0.4rem 0.6rem',
              background: 'var(--bg-secondary, #0a0a0a)',
              border: '1px solid var(--border-dim, #1a1a1a)',
              borderRadius: 3,
              fontSize: '0.72rem',
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              color: 'var(--text-secondary, #8a9bb0)',
              maxHeight: '12rem',
              overflowY: 'auto',
            }}>
              {h.content.trim()}
            </pre>
          </td>
        </tr>
      )}
    </>
  );
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
            top_k={rag.top_k ?? '—'} · min_score={rag.min_score ?? '—'} · click row to preview chunk
          </summary>
          <table style={{
            width: '100%',
            marginTop: '0.5rem',
            borderCollapse: 'collapse',
            fontSize: '0.85rem',
          }}>
            <thead>
              <tr style={{ textAlign: 'left', opacity: 0.7 }}>
                <th style={{ padding: '0.2rem 0.4rem' }}>source</th>
                <th style={{ padding: '0.2rem 0.4rem' }}>chunk</th>
                <th style={{ padding: '0.2rem 0.4rem' }}>distance</th>
              </tr>
            </thead>
            <tbody>
              {hits.map((h, i) => <HitRow key={`${h.source_path}-${h.chunk_idx}-${i}`} h={h} i={i} />)}
            </tbody>
          </table>
        </details>
      )}
    </section>
  );
}

export default RagSources;
