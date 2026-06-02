import React, { useState } from 'react';
import Button from './Button';
import { exportPreset, duplicatePreset } from '../api/presetsApi';

export default function PresetActions({ name, busy, onApply, onDelete, onDuplicated }) {
  const [working, setWorking] = useState(false);
  const [err, setErr] = useState(null);

  const wrap = async (fn) => {
    setWorking(true);
    setErr(null);
    try { await fn(); }
    catch (e) { setErr(e.message); console.error('[PresetActions]', e); }
    finally { setWorking(false); }
  };

  const handleExport = () => wrap(() => exportPreset(name));

  const handleDuplicate = () => wrap(async () => {
    const copy = `${name}-copy`;
    await duplicatePreset(name, copy);
    onDuplicated?.(copy);
  });

  return (
    <span style={{ display: 'inline-flex', gap: '0.25rem', alignItems: 'center' }}>
      <Button variant="outline-primary" size="sm"
        onClick={() => onApply(name)} disabled={busy || working}>Apply</Button>
      <Button variant="ghost" size="xs" title="Export as JSON"
        onClick={handleExport} disabled={busy || working}>↓</Button>
      <Button variant="ghost" size="xs" title={`Duplicate as ${name}-copy`}
        onClick={handleDuplicate} disabled={busy || working}>⎘</Button>
      <Button variant="outline-error" size="xs"
        onClick={() => onDelete(name)} disabled={busy || working}>✕</Button>
      {err && <span style={{ fontSize: '0.68rem', color: 'var(--brew-kv-crit, #e55)' }}>{err}</span>}
    </span>
  );
}
