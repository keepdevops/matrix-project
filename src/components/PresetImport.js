import React, { useRef, useState } from 'react';
import Button from './Button';
import { importPreset } from '../api/presetsApi';

const KNOWN_FIELDS = new Set(['agents', 'synthesizer', 'max_select', 'mode', 'pipeline_order']);

function validate(data) {
  if (typeof data !== 'object' || data === null || Array.isArray(data))
    throw new Error('JSON must be an object');
  if (!Object.keys(data).some(k => KNOWN_FIELDS.has(k)))
    throw new Error('No recognised preset fields (agents, synthesizer, max_select…)');
}

export default function PresetImport({ onImported }) {
  const fileRef = useRef(null);
  const [name, setName]     = useState('');
  const [status, setStatus] = useState(null); // null | 'ok' | 'err'
  const [msg, setMsg]       = useState('');
  const [busy, setBusy]     = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file || !name.trim()) return;
    setBusy(true);
    setStatus(null);
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      validate(data);
      await importPreset(name.trim(), data);
      setStatus('ok');
      setMsg(`Imported as "${name.trim()}"`);
      setName('');
      if (fileRef.current) fileRef.current.value = '';
      onImported?.(name.trim());
    } catch (err) {
      setStatus('err');
      setMsg(err.message);
      console.error('[PresetImport]', err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}
          style={{ display: 'flex', gap: '0.3rem', alignItems: 'center', flexWrap: 'wrap',
                   marginTop: '0.5rem' }}>
      <input ref={fileRef} type="file" accept=".json"
             style={{ fontSize: '0.78rem' }} disabled={busy} />
      <input type="text" placeholder="preset name"
             value={name} onChange={e => setName(e.target.value)}
             style={{ padding: '0.2rem 0.4rem', fontSize: '0.82rem', width: '10rem' }}
             disabled={busy} />
      <Button type="submit" variant="outline-primary" size="sm"
              disabled={busy || !name.trim()}>Import</Button>
      {status === 'ok' && <span style={{ color: 'var(--color-success, #22c55e)', fontSize: '0.78rem' }}>{msg}</span>}
      {status === 'err' && <span style={{ color: 'var(--brew-kv-crit, #e55)', fontSize: '0.78rem' }}>{msg}</span>}
    </form>
  );
}
