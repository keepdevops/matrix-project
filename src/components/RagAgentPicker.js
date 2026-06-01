import React from 'react';

export default function RagAgentPicker({ activeAgents, selectedRagAgents, setSelectedRagAgents, loading, disabled }) {
  if (!activeAgents || activeAgents.length === 0) return null;
  return (
    <div style={{ marginTop: '0.5rem' }}>
      <span style={{ fontSize: '0.78rem', opacity: 0.7 }}>
        Target agents{' '}
        <span style={{ fontSize: '0.7rem', opacity: 0.6 }}>(none = all)</span>:
      </span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: '0.25rem' }}>
        {activeAgents.map(({ name }) => (
          <label key={name} style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
            <input
              type="checkbox"
              checked={selectedRagAgents.includes(name)}
              onChange={(e) => {
                setSelectedRagAgents(prev =>
                  e.target.checked ? [...prev, name] : prev.filter(n => n !== name)
                );
              }}
              disabled={loading || disabled}
            />
            {name}
          </label>
        ))}
      </div>
    </div>
  );
}
