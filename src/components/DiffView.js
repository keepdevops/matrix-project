import React, { useMemo } from 'react';
import { wordDiff } from '../utils/wordDiff';

function DiffTokens({ tokens, side }) {
  return (
    <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  fontSize: '0.78rem', lineHeight: 1.55 }}>
      {tokens.map((tok, i) => {
        if (tok.type === 'same') return <span key={i}>{tok.text}</span>;
        if (side === 'a' && tok.type === 'remove')
          return <mark key={i} style={{ background: 'rgba(239,68,68,0.25)',
                                        textDecoration: 'line-through',
                                        color: 'var(--color-danger, #ef4444)' }}>{tok.text}</mark>;
        if (side === 'b' && tok.type === 'add')
          return <mark key={i} style={{ background: 'rgba(34,197,94,0.2)',
                                        color: 'var(--color-success, #22c55e)' }}>{tok.text}</mark>;
        return null;
      })}
    </pre>
  );
}

export default function DiffView({ textA, textB, labelA = 'A', labelB = 'B' }) {
  const tokens = useMemo(() => wordDiff(textA || '', textB || ''), [textA, textB]);

  const colStyle = {
    flex: 1, minWidth: 0,
    background: 'var(--bg-secondary, #111)',
    border: '1px solid var(--border-dim, #1a1a1a)',
    borderRadius: 4, padding: '0.5rem 0.6rem',
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.25rem',
                    fontSize: '0.72rem', opacity: 0.6 }}>
        <span style={{ flex: 1 }}>{labelA}</span>
        <span style={{ flex: 1 }}>{labelB}</span>
      </div>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <div style={colStyle}>
          <DiffTokens tokens={tokens} side="a" />
        </div>
        <div style={colStyle}>
          <DiffTokens tokens={tokens} side="b" />
        </div>
      </div>
    </div>
  );
}
