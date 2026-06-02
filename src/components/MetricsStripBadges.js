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
        <span title={`Prompt compressed: ${meta.context_gate.original_chars} → ${meta.context_gate.summary_chars} chars${meta.context_gate.fidelity_ratio != null ? ` · fidelity ${Math.round(meta.context_gate.fidelity_ratio * 100)}%` : ''}`}
              style={chip({ background: 'var(--color-primary, #4a9eff)' })}>
          CTX{meta.context_gate.fidelity_ratio != null
            ? ` ${Math.round(meta.context_gate.fidelity_ratio * 100)}%` : ''}
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
      {meta.supervisor?.any_intervention && (
        <span title={`Supervisor intervened: ${(meta.supervisor.decisions || []).filter(d => d.action !== 'ok').map(d => `${d.agent}→${d.action}`).join(', ')}`}
              style={chip({ background: '#7c3aed', marginLeft: '0.4rem' })}>
          SUPV
        </span>
      )}
      {overrunAgents.length > 0 && (
        <span title={`Contract overrun: ${overrunAgents.join(', ')}`}
              style={chip({ background: 'var(--color-danger, #ef4444)' })}>
          OVER {overrunAgents.length}
        </span>
      )}
      {meta.kv_layer_eviction && meta.kv_layer_eviction.length > 0 && (
        <span title={`Layer-priority KV eviction: ports ${meta.kv_layer_eviction.join(', ')}`}
              style={chip({ background: '#0891b2' })}>
          LYR {meta.kv_layer_eviction.length}
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
