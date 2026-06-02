import React, { useState } from 'react';
import Button from './Button';
import { exportTrajectories } from '../api/trajectoryApi';

export default function ExportFilterPanel({ sessionId }) {
  const [sid,    setSid]    = useState(sessionId || '');
  const [from,   setFrom]   = useState('');
  const [to,     setTo]     = useState('');
  const [format, setFormat] = useState('jsonl');

  const handleExport = () => {
    exportTrajectories({ sessionId: sid.trim(), from, to, format });
  };

  const inputStyle = { padding: '0.2rem 0.35rem', fontSize: '0.78rem',
                       width: '100%', boxSizing: 'border-box' };

  return (
    <div style={{ padding: '0.5rem', fontSize: '0.78rem' }}>
      <div style={{ fontWeight: 600, marginBottom: '0.4rem' }}>EXPORT DATASET</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
        <label>
          <span style={{ opacity: 0.65 }}>Session ID</span>
          <input style={inputStyle} value={sid} onChange={e => setSid(e.target.value)}
                 placeholder="(all sessions)" />
        </label>
        <div style={{ display: 'flex', gap: '0.3rem' }}>
          <label style={{ flex: 1 }}>
            <span style={{ opacity: 0.65 }}>From</span>
            <input type="date" style={inputStyle} value={from} onChange={e => setFrom(e.target.value)} />
          </label>
          <label style={{ flex: 1 }}>
            <span style={{ opacity: 0.65 }}>To</span>
            <input type="date" style={inputStyle} value={to} onChange={e => setTo(e.target.value)} />
          </label>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <span style={{ opacity: 0.65 }}>Format</span>
          <select value={format} onChange={e => setFormat(e.target.value)}
                  style={{ fontSize: '0.78rem', padding: '0.15rem 0.25rem' }}>
            <option value="jsonl">JSONL (distillation app)</option>
            <option value="json">JSON array</option>
          </select>
        </label>
        <Button variant="outline-primary" size="sm" onClick={handleExport}>
          ↓ Export
        </Button>
      </div>
    </div>
  );
}
