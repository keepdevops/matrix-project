import React, { useState } from 'react';

export function basename(p) {
  if (typeof p !== 'string' || !p) return '(unknown)';
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return idx >= 0 ? p.slice(idx + 1) : p;
}

export function formatDistance(d) {
  if (typeof d !== 'number' || Number.isNaN(d)) return '—';
  return d.toFixed(4);
}

function relevanceColor(r) {
  if (r >= 0.7) return 'var(--color-success, #22c55e)';
  if (r >= 0.4) return 'var(--kv-warn, #ffae00)';
  return 'var(--text-dim, #555)';
}

export function HitRow({ h, i }) {
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
        {h.relevance != null && (
          <td style={{ padding: '0.2rem 0.4rem', color: relevanceColor(h.relevance),
                       fontWeight: h.relevance >= 0.7 ? 600 : undefined }}
              title={`Re-rank relevance: ${h.relevance.toFixed(3)}`}>
            {h.relevance.toFixed(2)}
          </td>
        )}
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
