import React, { useMemo } from 'react';
import Button from './Button';

const VARIANTS_CONTAINER_STYLE = {
  display: 'flex',
  gap: '0.5rem',
  overflowX: 'auto',
  paddingBottom: '0.35rem',
  marginTop: '0.35rem',
};

const FOOTER_STYLE = { marginTop: '0.5rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' };
const FOOTER_LABEL_STYLE = { fontSize: '0.8rem', opacity: 0.85 };
const NAME_ROW_STYLE = { fontWeight: 700, marginBottom: '0.25rem', display: 'flex', justifyContent: 'space-between' };
const SELECTED_LABEL_STYLE = { color: 'var(--color-accent)', fontSize: '0.7rem' };
const PRE_STYLE = { whiteSpace: 'pre-wrap', margin: 0, userSelect: 'text' };
const CARD_BASE_STYLE = {
  flex: '0 0 min(280px, 45vw)',
  maxHeight: '180px',
  overflow: 'auto',
  fontSize: '0.78rem',
  borderRadius: 4,
  padding: '0.35rem',
  cursor: 'pointer',
  userSelect: 'none',
};

function VariantCard({ name, text, isPicked, onPickAgent }) {
  const cardStyle = useMemo(() => ({
    ...CARD_BASE_STYLE,
    border: isPicked
      ? '2px solid var(--color-accent)'
      : '1px solid color-mix(in srgb, var(--fg, #ccc) 25%, transparent)',
    boxShadow: isPicked ? '0 0 0 1px color-mix(in srgb, var(--color-accent) 40%, transparent)' : 'none',
    background: isPicked ? 'var(--color-accent-dim, rgba(0,255,65,0.06))' : 'transparent',
  }), [isPicked]);

  return (
    <div
      key={name}
      role="button"
      tabIndex={0}
      onClick={() => onPickAgent(isPicked ? null : name)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onPickAgent(isPicked ? null : name);
      }}
      style={cardStyle}
    >
      <div style={NAME_ROW_STYLE}>
        <span>{name}</span>
        {isPicked && <span style={SELECTED_LABEL_STYLE}>✓ SELECTED</span>}
      </div>
      <pre style={PRE_STYLE}>{text}</pre>
    </div>
  );
}

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
    <div className="final-answer-panel compare-variants-panel" style={{ marginTop: '0.75rem' }}>
      <div className="swarm-config-title">COMPARE VARIANTS</div>
      <div style={VARIANTS_CONTAINER_STYLE}>
        {activeAgents.map(({ name }) => {
          const text = responses[name];
          if (!text) return null;
          return (
            <VariantCard
              key={name}
              name={name}
              text={text}
              isPicked={flatPickAgent === name}
              onPickAgent={onPickAgent}
            />
          );
        })}
      </div>
      <div style={FOOTER_STYLE}>
        <span style={FOOTER_LABEL_STYLE}>
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
