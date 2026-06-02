import React from 'react';

const chip = (extra) => ({
  marginLeft: '0.4rem', opacity: 0.85, fontSize: '0.72rem',
  padding: '0 0.3rem', borderRadius: 3, color: '#fff', ...extra,
});

export default function MetricsStripBadges({ meta, excluded, tes }) {
  const overrunAgents = (meta.contracts || [])
    .filter(c => c.overrun)
    .map(c => c.agent);

  return (
    <>
      {meta.context_gate?.triggered && (
        <span title={`Prompt compressed: ${meta.context_gate.original_chars} → ${meta.context_gate.summary_chars} chars`}
              style={chip({ background: 'var(--color-primary, #4a9eff)' })}>
          CTX
        </span>
      )}
      {meta.auto_clear_kv && (
        <span title="KV cache auto-cleared (high pressure + topic switch)"
              style={chip({ marginLeft: '0.3rem', background: 'var(--kv-warn, #ffae00)', color: '#000' })}>
          KV↺
        </span>
      )}
      {excluded && excluded.length > 0 && (
        <span title={`Excluded (circuit open): ${excluded.join(', ')}`}
              style={chip({ background: 'var(--color-danger, #ef4444)' })}>
          EXCL {excluded.length}
        </span>
      )}
      {overrunAgents.length > 0 && (
        <span title={`Contract overrun: ${overrunAgents.join(', ')}`}
              style={chip({ background: 'var(--color-danger, #ef4444)' })}>
          OVER {overrunAgents.length}
        </span>
      )}
      {tes != null && (
        <span title={`Token Efficiency Score: ${tes.toFixed(2)} tok/ms`}
              style={chip({ background: 'var(--color-success, #22c55e)' })}>
          TES {tes.toFixed(2)}
        </span>
      )}
    </>
  );
}
