import React from 'react';

// Horizontal spark bars showing symbolic importance score per agent (0–1).
export default function ImportanceBar({ importance }) {
  if (!importance || typeof importance !== 'object') return null;
  const entries = Object.entries(importance).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return null;

  return (
    <div className="importance-bar" style={{ marginTop: '0.3rem', fontSize: '0.7rem' }}>
      <div style={{ opacity: 0.55, marginBottom: '0.15rem' }}>IMPORTANCE</div>
      {entries.map(([name, score]) => {
        const pct = Math.round(score * 100);
        const color = score >= 0.7 ? 'var(--color-success, #22c55e)'
                    : score >= 0.4 ? 'var(--kv-warn, #ffae00)'
                    :                'var(--text-dim, #555)';
        return (
          <div key={name} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', marginBottom: '0.1rem' }}>
            <span style={{ width: '5rem', overflow: 'hidden', textOverflow: 'ellipsis',
                           whiteSpace: 'nowrap', opacity: 0.75 }}>{name}</span>
            <div style={{ flex: 1, height: 4, background: 'var(--bg-secondary, #111)',
                          borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${pct}%`, background: color }} />
            </div>
            <span style={{ width: '2.5rem', textAlign: 'right', opacity: 0.7 }}>{pct}%</span>
          </div>
        );
      })}
    </div>
  );
}
