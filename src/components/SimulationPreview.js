import React from 'react';

export default function SimulationPreview({ result }) {
  if (!result) return null;
  const { estimated_tokens, estimated_tes, would_overrun,
          effective_max_select, agent_estimates } = result;

  return (
    <div className="sim-preview" style={{
      fontSize: '0.72rem', padding: '0.4rem 0.5rem',
      background: 'var(--bg-secondary, #111)', borderRadius: 4,
      border: `1px solid ${would_overrun ? 'var(--color-danger, #ef4444)' : 'var(--border-dim, #1a1a1a)'}`,
    }}>
      <div style={{ opacity: 0.55, marginBottom: '0.2rem' }}>SIMULATION ESTIMATE</div>
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        <span>~{estimated_tokens.toLocaleString()} tok</span>
        <span>TES {estimated_tes.toFixed(2)}</span>
        <span>max_select {effective_max_select}</span>
        {would_overrun && (
          <span style={{ color: 'var(--color-danger, #ef4444)', fontWeight: 600 }}>
            WOULD OVERRUN
          </span>
        )}
      </div>
      {agent_estimates && Object.keys(agent_estimates).length > 0 && (
        <div style={{ marginTop: '0.25rem', opacity: 0.65 }}>
          {Object.entries(agent_estimates).map(([name, e]) => (
            <span key={name} style={{ marginRight: '0.6rem' }}>
              {name}: ~{e.expected_tokens}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
