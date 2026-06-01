import React from 'react';

// health: { recent_failures, tripped, cooldown_remaining_ms } or undefined
export default function AgentHealthBadge({ name, health }) {
  if (!health) return null;

  const tripped = health.tripped;
  const warn    = !tripped && health.recent_failures > 0;
  const color   = tripped ? 'var(--color-danger, #ef4444)'
                : warn    ? 'var(--kv-warn, #ffae00)'
                :           'var(--color-success, #22c55e)';
  const label   = tripped ? `${name}: circuit open (${health.cooldown_remaining_ms}ms cooldown)`
                : warn    ? `${name}: ${health.recent_failures} recent failure(s)`
                :           `${name}: healthy`;

  return (
    <span
      title={label}
      className="agent-health-badge"
      style={{
        display: 'inline-block', width: 8, height: 8,
        borderRadius: '50%', background: color,
        marginRight: '0.25rem', verticalAlign: 'middle',
      }}
    />
  );
}
