import React from 'react';
import Button from './Button';
import { useModelConverterRow } from './useModelConverterRow';

function ProgressBar({ pct }) {
  return (
    <div style={{ background: '#111', borderRadius: 3, height: 6, width: '100%', overflow: 'hidden' }}>
      <div style={{ width: `${Math.min(100, pct || 0)}%`, height: '100%',
        background: pct === 100 ? '#00ff41' : '#0af', transition: 'width 0.4s ease' }} />
    </div>
  );
}

export default function ModelConverterRow({ model, onDone }) {
  const {
    open, setOpen, hfRepo, setHfRepo, outputName, setOutputName,
    qBits, setQBits, hfToken, setHfToken, job, error, busy, done, start,
  } = useModelConverterRow({ model, onDone });

  return (
    <div style={{ borderBottom: '1px solid #1a1a1a', padding: '4px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontFamily: 'monospace', fontSize: '0.78rem', color: '#888', flex: 1,
                       overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {model.name}
        </span>
        {done
          ? <span style={{ color: '#00ff41', fontSize: '0.75rem' }}>✓ converted</span>
          : <Button variant="ghost" size="xs" onClick={() => setOpen(o => !o)} disabled={busy}>→ MLX</Button>
        }
      </div>

      {open && !done && (
        <div style={{ marginTop: 6, padding: '8px 10px', background: '#0a0a0a',
                      border: '1px solid #222', borderRadius: 4 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: '0.7rem', color: '#666', textTransform: 'uppercase' }}>HuggingFace repo</label>
            <input value={hfRepo} onChange={e => setHfRepo(e.target.value)} placeholder="org/model-name"
              disabled={busy} style={{ fontFamily: 'monospace', fontSize: '0.8rem', padding: '3px 6px',
              background: '#000', color: '#dde', border: '1px solid #333', borderRadius: 3 }} />

            <label style={{ fontSize: '0.7rem', color: '#666', textTransform: 'uppercase' }}>Output folder name</label>
            <input value={outputName} onChange={e => setOutputName(e.target.value)} placeholder="model-name-4bit"
              disabled={busy} style={{ fontFamily: 'monospace', fontSize: '0.8rem', padding: '3px 6px',
              background: '#000', color: '#dde', border: '1px solid #333', borderRadius: 3 }} />

            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <span style={{ fontSize: '0.7rem', color: '#666', textTransform: 'uppercase' }}>Bits</span>
              {[4, 8].map(b => (
                <label key={b} style={{ fontSize: '0.8rem', cursor: 'pointer', display: 'flex', gap: 4 }}>
                  <input type="radio" checked={qBits === b} onChange={() => setQBits(b)} disabled={busy} />
                  {b}-bit
                </label>
              ))}
            </div>

            <label style={{ fontSize: '0.7rem', color: '#666', textTransform: 'uppercase' }}>
              HF Token <span style={{ textTransform: 'none', color: '#444' }}>(optional, for gated models)</span>
            </label>
            <input type="password" value={hfToken} onChange={e => setHfToken(e.target.value)}
              placeholder="hf_…" disabled={busy}
              style={{ fontFamily: 'monospace', fontSize: '0.8rem', padding: '3px 6px',
              background: '#000', color: '#dde', border: '1px solid #333', borderRadius: 3 }} />

            {job && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <ProgressBar pct={job.pct} />
                <span style={{ fontSize: '0.72rem', color: '#666' }}>
                  {job.step} {job.pct > 0 ? `— ${job.pct}%` : ''}
                </span>
              </div>
            )}
            {error && <span style={{ fontSize: '0.75rem', color: '#f77' }}>{error}</span>}

            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="outline-primary" size="sm" onClick={start} disabled={busy || !hfRepo || !outputName}>
                {busy ? 'Converting…' : 'Start'}
              </Button>
              <Button variant="ghost" size="sm"
                onClick={() => { setOpen(false); }} disabled={busy}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
