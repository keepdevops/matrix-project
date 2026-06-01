import React from 'react';

function colorFor(pct) {
  if (pct >= 90) return 'var(--kv-crit, #ff4136)';
  if (pct >= 75) return 'var(--kv-warn, #ffae00)';
  return 'var(--color-primary, #4a9eff)';
}

export default function TokenBudgetBar({ budget, consumed, remaining, overrun }) {
  if (!budget || budget <= 0) return null;

  const pct = Math.min(100, Math.round((consumed / budget) * 100));
  const label = overrun
    ? 'OVERRUN'
    : remaining >= 0 ? `${remaining.toLocaleString()} left` : '';

  return (
    <div className="token-budget-bar" style={{ padding: '0.4rem 0.5rem', fontSize: '0.75rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.2rem', opacity: 0.8 }}>
        <span>Token budget</span>
        <span style={{ color: overrun ? 'var(--kv-crit, #ff4136)' : undefined }}>{label}</span>
      </div>
      <div style={{ height: 4, background: 'var(--bg-secondary, #111)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: colorFor(pct), transition: 'width 0.3s' }} />
      </div>
      <div style={{ marginTop: '0.15rem', opacity: 0.55 }}>
        {consumed.toLocaleString()} / {budget.toLocaleString()} tokens ({pct}%)
      </div>
    </div>
  );
}
