import React from 'react';

export default function QualityPassSelector({ activeAgents, value, onChange, disabled }) {
  if (!activeAgents || activeAgents.length === 0) return null;

  return (
    <label style={{ fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
           title="Agent to use for the Quality Pass follow-up">
      <span style={{ opacity: 0.75 }}>QP target</span>
      <select
        value={value || ''}
        onChange={(e) => onChange?.(e.target.value || null)}
        disabled={disabled}
        style={{ fontSize: '0.78rem', padding: '0.1rem 0.25rem' }}
      >
        <option value="">default</option>
        {activeAgents.map(({ name }) => (
          <option key={name} value={name}>{name}</option>
        ))}
      </select>
    </label>
  );
}
