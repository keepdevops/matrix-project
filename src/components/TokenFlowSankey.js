import React from 'react';

// Token flow visualization: Budget → Mode → Agents
// Uses meta.contracts (per-agent allocation/used) and meta.token_budget.
export default function TokenFlowSankey({ meta }) {
  const contracts = meta?.contracts;
  const tb        = meta?.token_budget || {};
  if (!contracts || contracts.length === 0) return null;

  const budget  = tb.budget  || 0;
  const consumed = tb.consumed || 0;
  const maxAlloc = Math.max(...contracts.map(c => c.allocation || 0), consumed, 1);

  const barW = (v) => `${Math.min(100, Math.round((v / maxAlloc) * 100))}%`;
  const color = (c) => c.overrun ? 'var(--color-danger, #ef4444)'
                     : (c.used / (c.allocation || 1)) > 0.8 ? 'var(--kv-warn, #ffae00)'
                     : 'var(--color-primary, #4a9eff)';

  return (
    <div className="token-flow-sankey" style={{ fontSize: '0.72rem', marginTop: '0.4rem' }}>
      <div style={{ opacity: 0.55, marginBottom: '0.25rem' }}>TOKEN FLOW</div>

      {budget > 0 && (
        <div style={{ marginBottom: '0.3rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', opacity: 0.7 }}>
            <span>Session budget</span><span>{consumed}/{budget}</span>
          </div>
          <div style={{ height: 6, background: 'var(--bg-secondary, #111)', borderRadius: 3 }}>
            <div style={{ height: '100%', width: barW(consumed), borderRadius: 3,
                          background: consumed > budget ? 'var(--color-danger, #ef4444)'
                                      : 'var(--color-success, #22c55e)' }} />
          </div>
        </div>
      )}

      <div style={{ borderLeft: '2px solid var(--border-dim, #222)',
                    paddingLeft: '0.5rem', marginLeft: '0.25rem' }}>
        {contracts.map(c => (
          <div key={c.agent} style={{ marginBottom: '0.2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', opacity: 0.75 }}>
              <span>{c.agent}{c.overrun ? ' ⚠' : ''}</span>
              <span>{c.used}/{c.allocation > 0 ? c.allocation : '∞'}</span>
            </div>
            <div style={{ height: 4, background: 'var(--bg-secondary, #111)', borderRadius: 2 }}>
              <div style={{ height: '100%', width: barW(c.used),
                            background: color(c), borderRadius: 2 }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
