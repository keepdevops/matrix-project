import React, { useState } from 'react';
import Button from './Button';
import { extractVariables, substitute } from '../utils/templateSubstitute';
import { useTemplates } from '../hooks/useTemplates';

function TemplateUseForm({ text, onInsert, onCancel }) {
  const vars = extractVariables(text);
  const [vals, setVals] = useState(() => Object.fromEntries(vars.map(v => [v, ''])));

  if (vars.length === 0) {
    return (
      <div style={{ marginTop: '0.3rem' }}>
        <Button size="sm" variant="outline-primary" onClick={() => onInsert(text)}>Insert</Button>
        <Button size="xs" variant="ghost" onClick={onCancel} style={{ marginLeft: '0.3rem' }}>Cancel</Button>
      </div>
    );
  }
  return (
    <div style={{ marginTop: '0.3rem', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
      {vars.map(v => (
        <label key={v} style={{ fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
          <span style={{ opacity: 0.7, minWidth: '6rem' }}>{v}</span>
          <input value={vals[v]} onChange={e => setVals(p => ({ ...p, [v]: e.target.value }))}
                 style={{ flex: 1, padding: '0.15rem 0.3rem', fontSize: '0.78rem' }} />
        </label>
      ))}
      <div style={{ display: 'flex', gap: '0.3rem', marginTop: '0.15rem' }}>
        <Button size="sm" variant="outline-primary" onClick={() => onInsert(substitute(text, vals))}>Insert</Button>
        <Button size="xs" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

export default function TemplateManager({ onInsert }) {
  const { templates, save, remove, loading, error } = useTemplates();
  const [newName, setNewName] = useState('');
  const [newText, setNewText] = useState('');
  const [using, setUsing]     = useState(null);

  const handleSave = async () => {
    if (!newName.trim() || !newText.trim()) return;
    await save(newName.trim(), { text: newText.trim() });
    setNewName(''); setNewText('');
  };

  return (
    <div style={{ fontSize: '0.78rem', padding: '0.5rem' }}>
      <div style={{ fontWeight: 600, marginBottom: '0.4rem' }}>TEMPLATES</div>

      {Object.entries(templates).map(([name, tmpl]) => (
        <div key={name} style={{ marginBottom: '0.4rem', padding: '0.3rem 0.4rem',
                                  background: 'var(--bg-secondary, #111)', borderRadius: 3 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 500 }}>{name}</span>
            <span style={{ display: 'flex', gap: '0.2rem' }}>
              <Button size="xs" variant="outline-primary"
                      onClick={() => setUsing(using === name ? null : name)}>Use</Button>
              <Button size="xs" variant="outline-error"
                      onClick={() => { if (window.confirm(`Delete "${name}"?`)) remove(name); }}>✕</Button>
            </span>
          </div>
          <div style={{ opacity: 0.55, marginTop: '0.1rem', fontSize: '0.72rem',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {tmpl.text}
          </div>
          {using === name && (
            <TemplateUseForm text={tmpl.text}
              onInsert={t => { onInsert?.(t); setUsing(null); }}
              onCancel={() => setUsing(null)} />
          )}
        </div>
      ))}

      <div style={{ marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
        <input placeholder="template name" value={newName} onChange={e => setNewName(e.target.value)}
               style={{ padding: '0.2rem 0.35rem', fontSize: '0.78rem' }} />
        <textarea placeholder="Template text — use {{variable}} for substitutions"
                  value={newText} onChange={e => setNewText(e.target.value)}
                  rows={3} style={{ padding: '0.2rem 0.35rem', fontSize: '0.78rem', resize: 'vertical' }} />
        <Button size="sm" variant="outline-primary" onClick={handleSave}
                disabled={loading || !newName.trim() || !newText.trim()}>Save template</Button>
      </div>
      {error && <div style={{ color: 'var(--color-danger, #ef4444)', marginTop: '0.3rem' }}>{error}</div>}
    </div>
  );
}
