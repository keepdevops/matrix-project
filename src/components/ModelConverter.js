import React, { useState, useEffect, useRef } from 'react';
import { startConversion, pollConversion, fetchModels, invalidateModelsCache } from '../api/swarmApi';

// Guess the HuggingFace repo ID from a GGUF filename.
// e.g. "Codestral-22B-v0.1-Q4_K_M.gguf" → "mistralai/Codestral-22B-v0.1"
const ORG_PREFIXES = [
  [/^meta-llama/i,   'meta-llama'],
  [/^llama/i,        'meta-llama'],
  [/^codestral/i,    'mistralai'],
  [/^mistral/i,      'mistralai'],
  [/^mixtral/i,      'mistralai'],
  [/^gemma/i,        'google'],
  [/^phi-/i,         'microsoft'],
  [/^phi\d/i,        'microsoft'],
  [/^qwen/i,         'Qwen'],
  [/^deepseek/i,     'deepseek-ai'],
];

function guessHfRepo(filename) {
  // Strip path and extension, remove quantization suffix like -Q4_K_M or -q4_0
  const base = filename.replace(/\.gguf$/i, '').replace(/(-[Qq]\d[^-]*|-IQ\d[^-]*)(_[A-Z0-9]+)*$/, '');
  for (const [re, org] of ORG_PREFIXES) {
    if (re.test(base)) return `${org}/${base}`;
  }
  return base;
}

function guessOutputName(filename) {
  const base = filename.replace(/\.gguf$/i, '').replace(/(-[Qq]\d[^-]*|-IQ\d[^-]*)(_[A-Z0-9]+)*$/, '');
  return base;
}

function ProgressBar({ pct }) {
  return (
    <div style={{ background: '#111', borderRadius: 3, height: 6, width: '100%', overflow: 'hidden' }}>
      <div style={{
        width: `${Math.min(100, pct || 0)}%`,
        height: '100%',
        background: pct === 100 ? '#00ff41' : '#0af',
        transition: 'width 0.4s ease',
      }} />
    </div>
  );
}

function ConvertRow({ model, onDone }) {
  const [open,       setOpen]       = useState(false);
  const [hfRepo,     setHfRepo]     = useState(() => guessHfRepo(model.name));
  const [outputName, setOutputName] = useState(() => guessOutputName(model.name));
  const [qBits,      setQBits]      = useState(4);
  const [hfToken,    setHfToken]    = useState('');
  const [job,        setJob]        = useState(null);
  const [error,      setError]      = useState(null);
  const pollRef = useRef(null);

  const stopPolling = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };

  useEffect(() => () => stopPolling(), []);

  const start = async () => {
    setError(null);
    try {
      const { job_id } = await startConversion({ hf_repo: hfRepo, output_name: outputName, q_bits: qBits, hf_token: hfToken });
      setJob({ job_id, status: 'running', step: 'starting', pct: 0 });
      pollRef.current = setInterval(async () => {
        try {
          const j = await pollConversion(job_id);
          setJob(j);
          if (j.status === 'done') { stopPolling(); if (onDone) onDone(); }
          if (j.status === 'error') { stopPolling(); setError(j.error || 'Conversion failed'); }
        } catch (e) { setError(e.message); stopPolling(); }
      }, 2000);
    } catch (e) {
      setError(e.message);
    }
  };

  const busy = job && job.status === 'running';
  const done = job && job.status === 'done';

  return (
    <div style={{ borderBottom: '1px solid #1a1a1a', padding: '4px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontFamily: 'monospace', fontSize: '0.78rem', color: '#888', flex: 1,
                       overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {model.name}
        </span>
        {done
          ? <span style={{ color: '#00ff41', fontSize: '0.75rem' }}>✓ converted</span>
          : <button onClick={() => setOpen(o => !o)} disabled={busy}
                    style={{ fontSize: '0.72rem', padding: '2px 8px', cursor: 'pointer' }}>
              → MLX
            </button>
        }
      </div>

      {open && !done && (
        <div style={{ marginTop: 6, padding: '8px 10px', background: '#0a0a0a',
                      border: '1px solid #222', borderRadius: 4 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: '0.7rem', color: '#666', textTransform: 'uppercase' }}>
              HuggingFace repo
            </label>
            <input value={hfRepo} onChange={e => setHfRepo(e.target.value)}
                   placeholder="org/model-name" disabled={busy}
                   style={{ fontFamily: 'monospace', fontSize: '0.8rem', padding: '3px 6px',
                            background: '#000', color: '#dde', border: '1px solid #333', borderRadius: 3 }} />

            <label style={{ fontSize: '0.7rem', color: '#666', textTransform: 'uppercase' }}>
              Output folder name
            </label>
            <input value={outputName} onChange={e => setOutputName(e.target.value)}
                   placeholder="model-name-4bit" disabled={busy}
                   style={{ fontFamily: 'monospace', fontSize: '0.8rem', padding: '3px 6px',
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
            <input
              type="password"
              value={hfToken}
              onChange={e => setHfToken(e.target.value)}
              placeholder="hf_…"
              disabled={busy}
              style={{ fontFamily: 'monospace', fontSize: '0.8rem', padding: '3px 6px',
                       background: '#000', color: '#dde', border: '1px solid #333', borderRadius: 3 }}
            />

            {job && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <ProgressBar pct={job.pct} />
                <span style={{ fontSize: '0.72rem', color: '#666' }}>
                  {job.step} {job.pct > 0 ? `— ${job.pct}%` : ''}
                </span>
              </div>
            )}

            {error && (
              <span style={{ fontSize: '0.75rem', color: '#f77' }}>{error}</span>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={start} disabled={busy || !hfRepo || !outputName}
                      style={{ fontSize: '0.8rem', padding: '4px 12px', cursor: 'pointer' }}>
                {busy ? 'Converting…' : 'Start'}
              </button>
              <button onClick={() => { setOpen(false); setJob(null); setError(null); }}
                      disabled={busy}
                      style={{ fontSize: '0.8rem', padding: '4px 8px', cursor: 'pointer' }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ModelConverter({ models: modelsProp, onConversionDone, standalone }) {
  const [models, setModels]   = useState(modelsProp || []);
  const [loading, setLoading] = useState(standalone && !modelsProp);

  useEffect(() => {
    if (!standalone) return;
    setLoading(true);
    fetchModels().then(m => { setModels(m); setLoading(false); }).catch(() => setLoading(false));
  }, [standalone]);

  const handleDone = () => {
    invalidateModelsCache();
    fetchModels().then(setModels).catch(err => console.error('ModelConverter: failed to refresh models after conversion:', err));
    if (onConversionDone) onConversionDone();
  };

  const ggufModels = models.filter(m => m.backend === 'llama' || m.path?.endsWith?.('.gguf'));

  if (standalone) {
    return (
      <div>
        <h2 style={{ fontFamily: 'monospace', color: '#00ff41', fontSize: '1rem',
                     textTransform: 'uppercase', letterSpacing: 2, marginBottom: 16 }}>
          GGUF → MLX Converter
        </h2>
        <p style={{ fontSize: '0.8rem', color: '#666', marginBottom: 16 }}>
          Select a GGUF model, confirm its HuggingFace repo ID, and convert to MLX quantized format.
          Weights are downloaded from HuggingFace and saved to the local MLX model directory.
        </p>
        {loading && <p style={{ color: '#555', fontSize: '0.8rem' }}>Scanning models…</p>}
        {!loading && ggufModels.length === 0 && (
          <p style={{ color: '#555', fontSize: '0.8rem' }}>No GGUF models found in model directory.</p>
        )}
        {ggufModels.map(m => (
          <ConvertRow key={m.path || m.name} model={m} onDone={handleDone} />
        ))}
      </div>
    );
  }

  if (ggufModels.length === 0) return null;
  return (
    <div style={{ marginTop: 12, borderTop: '1px solid #1a1a1a', paddingTop: 8 }}>
      {ggufModels.map(m => (
        <ConvertRow key={m.path || m.name} model={m} onDone={handleDone} />
      ))}
    </div>
  );
}
