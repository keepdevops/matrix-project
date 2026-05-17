import React, { useState, useEffect } from 'react';
import { fetchAgents, fetchModels, fetchSwarmConfig, configureSwarm } from '../api/swarmApi';

function modelLabel(path) {
  if (!path) return '—';
  const parts = path.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || path;
}

function groupModelsByBackend(models) {
  const groups = {};
  for (const m of models) {
    const b = m.backend || 'llama';
    if (!groups[b]) groups[b] = [];
    groups[b].push(m);
  }
  return groups;
}

function ServerLayout({ servers }) {
  if (!servers?.length) return null;
  return (
    <div style={{ marginTop: 12, padding: '8px 10px', background: '#050505',
                  border: '1px solid #1a1a1a', borderRadius: 4 }}>
      <div style={{ fontSize: '0.68rem', color: '#555', textTransform: 'uppercase',
                    letterSpacing: 1, marginBottom: 6 }}>Server layout</div>
      {servers.map(s => (
        <div key={s.port} style={{ display: 'flex', gap: 8, marginBottom: 4,
                                   fontSize: '0.75rem', fontFamily: 'monospace' }}>
          <span style={{ color: '#0af', minWidth: 40 }}>:{s.port}</span>
          <span style={{ color: '#555' }}>{modelLabel(s.model)}</span>
          <span style={{ color: '#444' }}>→</span>
          <span style={{ color: '#888' }}>{(s.agents || []).join(', ')}</span>
        </div>
      ))}
    </div>
  );
}

export default function ModelSwapPanel({ onRedeployed }) {
  const [agents,    setAgents]    = useState([]);
  const [models,    setModels]    = useState([]);
  const [overrides, setOverrides] = useState({});
  const [status,    setStatus]    = useState('loading');
  const [error,     setError]     = useState(null);
  const [result,    setResult]    = useState(null);

  useEffect(() => {
    Promise.all([fetchSwarmConfig(), fetchAgents(), fetchModels()])
      .then(([swarmCfg, runningAgents, modelList]) => {
        // Use full agent definitions from swarm config as base (has all numeric fields),
        // then overlay the currently running model for each agent.
        const runningMap = {};
        runningAgents.forEach(a => { if (a.model) runningMap[a.name] = a.model; });
        const full = (swarmCfg.agents || []).map(a => ({
          ...a,
          model: runningMap[a.name] || a.model || '',
        }));
        setAgents(full);
        setModels(modelList.filter(m => m.backend !== 'vllm'));
        setStatus('idle');
      })
      .catch(e => { setError(e.message); setStatus('error'); });
  }, []);

  const dirtyCount = Object.keys(overrides).length;
  const grouped    = groupModelsByBackend(models);

  const handleChange = (agentName, value) => {
    setOverrides(prev => ({ ...prev, [agentName]: value }));
  };

  const handleRedeploy = async () => {
    setStatus('deploying');
    setError(null);
    setResult(null);
    const payload = agents.map(a => {
      const model     = overrides[a.name] || a.model;
      const modelMeta = models.find(m => m.path === model);
      const backend   = modelMeta?.backend || a.backend || a.engine || 'llama';
      return { ...a, model, backend };
    });
    try {
      const r = await configureSwarm(payload);
      setResult(r);
      setStatus('done');
      setOverrides({});
      if (onRedeployed) onRedeployed();
    } catch (e) {
      setError(e.message);
      setStatus('error');
    }
  };

  const handleReset = () => {
    setOverrides({});
    setError(null);
    setResult(null);
    setStatus('idle');
  };

  return (
    <div style={{ padding: '1rem 1.5rem', maxWidth: 860, margin: '0 auto' }}>
      <h2 style={{ fontFamily: 'monospace', color: '#00ff41', fontSize: '1rem',
                   textTransform: 'uppercase', letterSpacing: 2, marginBottom: 4 }}>
        Model Swap
      </h2>
      <p style={{ fontSize: '0.78rem', color: '#555', marginBottom: 16 }}>
        Change the model for any agent and redeploy. All inference servers restart (~2 min).
        Changes are live but not persisted to config files.
      </p>

      {status === 'loading' && (
        <p style={{ color: '#555', fontSize: '0.8rem' }}>Loading agents…</p>
      )}

      {status === 'deploying' && (
        <div style={{ padding: '12px 16px', background: '#0a0a0a', border: '1px solid #222',
                      borderRadius: 4, marginBottom: 12 }}>
          <p style={{ color: '#0af', fontFamily: 'monospace', fontSize: '0.82rem', margin: 0 }}>
            Redeploying… killing old servers and loading new models. This takes ~2 minutes.
          </p>
        </div>
      )}

      {agents.length > 0 && status !== 'deploying' && (
        <div style={{ border: '1px solid #1a1a1a', borderRadius: 4, overflow: 'hidden',
                      marginBottom: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr',
                        background: '#080808', padding: '4px 10px',
                        fontSize: '0.65rem', color: '#444', textTransform: 'uppercase',
                        letterSpacing: 1 }}>
            <span>Agent</span><span>Model</span>
          </div>
          {agents.map((a, i) => {
            const current  = overrides[a.name] || a.model || '';
            const isDirty  = !!overrides[a.name] && overrides[a.name] !== a.model;
            return (
              <div key={a.name} style={{
                display: 'grid', gridTemplateColumns: '120px 1fr',
                alignItems: 'center', gap: 8,
                padding: '5px 10px',
                background: isDirty ? '#0a0f0a' : (i % 2 === 0 ? '#050505' : '#070707'),
                borderTop: i > 0 ? '1px solid #111' : 'none',
              }}>
                <span style={{ fontFamily: 'monospace', fontSize: '0.78rem',
                               color: isDirty ? '#00ff41' : '#888' }}>
                  {isDirty && <span style={{ color: '#00ff41', marginRight: 4 }}>●</span>}
                  {a.name}
                </span>
                <select
                  value={current}
                  onChange={e => handleChange(a.name, e.target.value)}
                  style={{ fontFamily: 'monospace', fontSize: '0.75rem',
                           background: '#000', color: '#ccd', border: '1px solid #222',
                           borderRadius: 3, padding: '2px 4px', width: '100%' }}
                >
                  {Object.entries(grouped).map(([backend, mlist]) => (
                    <optgroup key={backend} label={backend.toUpperCase()}>
                      {mlist.map(m => (
                        <option key={m.path} value={m.path}>{m.name}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
      )}

      {error && (
        <div style={{ padding: '8px 10px', background: '#110000', border: '1px solid #330000',
                      borderRadius: 4, marginBottom: 10, fontSize: '0.78rem',
                      color: '#f77', fontFamily: 'monospace' }}>
          {error}
        </div>
      )}

      {result && <ServerLayout servers={result.servers} />}

      {status !== 'loading' && status !== 'deploying' && agents.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button
            onClick={handleRedeploy}
            disabled={status === 'deploying'}
            style={{ fontSize: '0.82rem', padding: '5px 14px', cursor: 'pointer',
                     background: dirtyCount > 0 ? '#003300' : undefined,
                     color: dirtyCount > 0 ? '#00ff41' : undefined,
                     border: dirtyCount > 0 ? '1px solid #00ff41' : undefined }}
          >
            {dirtyCount > 0 ? `Redeploy (${dirtyCount} change${dirtyCount > 1 ? 's' : ''})` : 'Redeploy'}
          </button>
          {dirtyCount > 0 && (
            <button onClick={handleReset}
                    style={{ fontSize: '0.82rem', padding: '5px 10px', cursor: 'pointer' }}>
              Reset
            </button>
          )}
        </div>
      )}
    </div>
  );
}
