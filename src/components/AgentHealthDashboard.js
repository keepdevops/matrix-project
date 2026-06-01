import React from 'react';
import AgentHealthBadge from './AgentHealthBadge';

const COOLDOWN_MS = 30000;

export default function AgentHealthDashboard({ byName }) {
  const entries = Object.entries(byName || {});

  if (entries.length === 0) {
    return (
      <div style={{ padding: '0.5rem', opacity: 0.5, fontSize: '0.78rem' }}>
        No agent health data
      </div>
    );
  }

  return (
    <div className="ahd" style={{ fontSize: '0.75rem' }}>
      <div style={{
        display: 'grid', gridTemplateColumns: '1rem 1fr 3rem 5rem',
        columnGap: '0.4rem', opacity: 0.55, marginBottom: '0.2rem',
      }}>
        <span />
        <span>agent</span>
        <span>fails</span>
        <span>cooldown</span>
      </div>
      {entries.map(([name, h]) => {
        const pct = h.tripped
          ? Math.max(0, Math.min(100, Math.round((h.cooldown_remaining_ms / COOLDOWN_MS) * 100)))
          : 0;
        return (
          <div key={name} style={{
            display: 'grid', gridTemplateColumns: '1rem 1fr 3rem 5rem',
            columnGap: '0.4rem', alignItems: 'center', marginBottom: '0.15rem',
          }}>
            <AgentHealthBadge name={name} health={h} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {name}
            </span>
            <span>{h.recent_failures}</span>
            <div style={{ height: 4, background: 'var(--bg-secondary, #222)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{
                height: '100%', width: `${pct}%`,
                background: 'var(--color-danger, #ef4444)', transition: 'width 0.5s',
              }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
