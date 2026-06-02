import React from 'react';

export default function TemplatePicker({ templates, onSelect, disabled }) {
  const names = Object.keys(templates || {});
  if (names.length === 0) return null;

  return (
    <select
      defaultValue=""
      onChange={e => { if (e.target.value) { onSelect?.(e.target.value); e.target.value = ''; } }}
      disabled={disabled}
      style={{ fontSize: '0.78rem', padding: '0.1rem 0.25rem' }}
      title="Load a prompt template"
    >
      <option value="" disabled>Templates…</option>
      {names.map(n => <option key={n} value={n}>{n}</option>)}
    </select>
  );
}
