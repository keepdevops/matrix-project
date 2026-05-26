import React from 'react';
import Button from './Button';

export default function CompareVariantsPanel({
  activeAgents,
  responses,
  loading,
  flatPickAgent,
  onPickAgent,
  onSendBest,
}) {
  if (!activeAgents || Object.keys(responses).length === 0) return null;

  return (
    <div className="final-answer-panel" style={{ marginTop: '0.75rem' }}>
      <div className="swarm-config-title">COMPARE VARIANTS</div>
      <div
        style={{
          display: 'flex',
          gap: '0.5rem',
          overflowX: 'auto',
          paddingBottom: '0.35rem',
          marginTop: '0.35rem',
        }}
      >
        {activeAgents.map(({ name }) => {
          const text = responses[name];
          if (!text) return null;
          const isPicked = flatPickAgent === name;
          return (
            <div
              key={name}
              role="button"
              tabIndex={0}
              onClick={() => onPickAgent(isPicked ? null : name)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') onPickAgent(isPicked ? null : name);
              }}
              style={{
                flex: '0 0 min(280px, 45vw)',
                maxHeight: '180px',
                overflow: 'auto',
                fontSize: '0.78rem',
                border: isPicked
                  ? '2px solid #00ff41'
                  : '1px solid color-mix(in srgb, var(--fg, #ccc) 25%, transparent)',
                borderRadius: 4,
                padding: '0.35rem',
                cursor: 'pointer',
                boxShadow: isPicked ? '0 0 0 1px #00ff4166' : 'none',
                background: isPicked ? 'rgba(0,255,65,0.06)' : 'transparent',
                userSelect: 'none',
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: '0.25rem', display: 'flex', justifyContent: 'space-between' }}>
                <span>{name}</span>
                {isPicked && <span style={{ color: '#00ff41', fontSize: '0.7rem' }}>✓ SELECTED</span>}
              </div>
              <pre style={{ whiteSpace: 'pre-wrap', margin: 0, userSelect: 'text' }}>{text}</pre>
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: '0.8rem', opacity: 0.85 }}>
          Pick best variant in the grid (highlight), then continue refinement:
        </span>
        <Button
          variant="outline-accent"
          size="md"
          type="button"
          disabled={loading || !flatPickAgent}
          onClick={onSendBest}
        >
          SEND BEST TO CONTINUE
        </Button>
      </div>
    </div>
  );
}
