import React, { useState } from 'react';
import Button from './Button';
import { exportTrajectories } from '../api/trajectoryApi';
import { pushTrajectories } from '../api/distillationApi';

export default function ExportFilterPanel({ sessionId }) {
  const [sid,        setSid]        = useState(sessionId || '');
  const [from,       setFrom]       = useState('');
  const [to,         setTo]         = useState('');
  const [minQuality, setMinQuality] = useState(0);
  const [format,     setFormat]     = useState('jsonl');
  const [pushUrl,    setPushUrl]    = useState('');
  const [pushStatus, setPushStatus] = useState(null);
  const [pushing,    setPushing]    = useState(false);

  const handleExport = () =>
    exportTrajectories({ sessionId: sid.trim(), from, to, format,
                         minQuality: minQuality > 0 ? minQuality : undefined });

  const handlePush = async () => {
    if (!pushUrl.trim()) return;
    setPushing(true); setPushStatus(null);
    try {
      const r = await pushTrajectories({
        sessionId: sid.trim() || undefined,
        minQuality: minQuality > 0 ? minQuality : undefined,
        targetUrl: pushUrl.trim(),
      });
      setPushStatus(r.pushed
        ? `✓ Pushed ${r.lines} records (HTTP ${r.status_code})`
        : `✗ ${r.error || 'push failed'}`);
    } catch (err) {
      setPushStatus(`✗ ${err.message}`);
      console.error('[ExportFilterPanel] push failed:', err);
    } finally {
      setPushing(false);
    }
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
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <span style={{ opacity: 0.65 }}>Min quality</span>
          <input type="range" min="0" max="1" step="0.1" value={minQuality}
                 onChange={e => setMinQuality(parseFloat(e.target.value))}
                 style={{ flex: 1 }} />
          <span style={{ width: '2.5rem', opacity: 0.8 }}>
            {minQuality > 0 ? minQuality.toFixed(1) : 'any'}
          </span>
        </label>
        <Button variant="outline-primary" size="sm" onClick={handleExport}>
          ↓ Export
        </Button>

        <div style={{ borderTop: '1px solid var(--border-dim, #1a1a1a)',
                      paddingTop: '0.3rem', marginTop: '0.1rem' }}>
          <div style={{ opacity: 0.65, marginBottom: '0.2rem' }}>Push to distillation app</div>
          <input style={inputStyle} value={pushUrl}
                 onChange={e => setPushUrl(e.target.value)}
                 placeholder="http://localhost:8765" />
          <Button variant="outline-primary" size="sm"
                  onClick={handlePush}
                  disabled={pushing || !pushUrl.trim()}
                  style={{ marginTop: '0.25rem', width: '100%' }}>
            {pushing ? 'Pushing…' : '→ Push'}
          </Button>
          {pushStatus && (
            <div style={{ marginTop: '0.2rem', fontSize: '0.7rem',
                          color: pushStatus.startsWith('✓')
                            ? 'var(--color-success, #22c55e)'
                            : 'var(--color-danger, #ef4444)' }}>
              {pushStatus}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
