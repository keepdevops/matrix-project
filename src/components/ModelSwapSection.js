import React, { useState, useEffect } from 'react';
import { fetchAgents, fetchModels, fetchSwarmConfig, configureSwarm } from '../api/swarmApi';

function groupByBackend(models) {
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
    <div className="swap-server-layout">
      <div className="swap-layout-label">Server layout after redeploy</div>
      {servers.map(s => (
        <div key={s.port} className="swap-layout-row">
          <span className="swap-layout-port">:{s.port}</span>
          <span className="swap-layout-model">{s.model?.split('/').pop()}</span>
          <span className="swap-layout-agents">{(s.agents || []).join(', ')}</span>
        </div>
      ))}
    </div>
  );
}

export default function ModelSwapSection({ onRedeployed }) {
  const [agents,         setAgents]         = useState([]);
  const [models,         setModels]         = useState([]);
  const [overrides,      setOverrides]      = useState({});
  const [extraOverrides, setExtraOverrides] = useState({});
  const [status,         setStatus]         = useState('loading');
  const [error,          setError]          = useState(null);
  const [result,         setResult]         = useState(null);

  useEffect(() => {
    Promise.all([fetchSwarmConfig(), fetchAgents(), fetchModels()])
      .then(([swarmCfg, running, modelList]) => {
        const runningMap = {};
        running.forEach(a => { if (a.model) runningMap[a.name] = a.model; });
        const full = (swarmCfg.agents || []).map(a => ({
          ...a,
          model: runningMap[a.name] || a.model || '',
        }));
        setAgents(full);
        setModels(modelList.filter(m => m.backend !== 'vllm'));
        setStatus('idle');
      })
      .catch(e => { console.error('[ModelSwapSection] load failed:', e); setError(e.message); setStatus('error'); });
  }, []);

  const grouped    = groupByBackend(models);
  const dirtyCount = Object.keys(overrides).length + Object.keys(extraOverrides).length;

  const currentExtraArgs = (a) => {
    if (a.name in extraOverrides) return extraOverrides[a.name];
    return Array.isArray(a.extra_args) ? a.extra_args.join(' ') : (a.extra_args || '');
  };
  const handleExtraChange = (name, value) => setExtraOverrides(prev => ({ ...prev, [name]: value }));

  const memoryWarnings = {};
  agents.forEach(a => {
    const newPath = overrides[a.name];
    if (!newPath || newPath === a.model) return;
    const cur  = models.find(m => m.path === a.model);
    const next = models.find(m => m.path === newPath);
    if (cur?.size_bytes > 0 && next?.size_bytes > 0 && next.size_bytes > cur.size_bytes) {
      const diffGB = ((next.size_bytes - cur.size_bytes) / 1e9).toFixed(1);
      const nextGB = (next.size_bytes / 1e9).toFixed(1);
      memoryWarnings[a.name] = `+${diffGB} GB larger (${nextGB} GB) — may exceed Metal pool`;
    }
  });

  const handleChange = (name, value) => setOverrides(prev => ({ ...prev, [name]: value }));

  const handleRedeploy = async () => {
    setStatus('deploying');
    setError(null);
    setResult(null);
    const payload = agents.map(a => {
      const model     = overrides[a.name] || a.model;
      const modelMeta = models.find(m => m.path === model);
      const backend   = modelMeta?.backend || a.backend || a.engine || 'llama';
      const extraRaw  = currentExtraArgs(a);
      const extra_args = extraRaw.trim() ? extraRaw.trim().split(/\s+/) : [];
      return { ...a, model, backend, extra_args };
    });
    try {
      const r = await configureSwarm(payload);
      setResult(r);
      setStatus('done');
      setOverrides({});
      setExtraOverrides({});
      if (onRedeployed) onRedeployed();
    } catch (e) {
      console.error('[ModelSwapSection] redeploy failed:', e);
      setError(e.message);
      setStatus('error');
    }
  };

  if (status === 'loading') return <div className="swap-loading">Loading running agents…</div>;
  if (status === 'error' && agents.length === 0)
    return <div className="swap-error">{error}</div>;

  const hasMemoryWarning = Object.keys(memoryWarnings).length > 0;

  return (
    <div className="model-swap-section">
      <p className="swap-hint">
        Change models on the running swarm and redeploy without editing config files.
        All inference servers restart (~2 min).
      </p>

      {agents.length > 0 && status !== 'deploying' && (
        <div className="swap-agent-list">
          {agents.map(a => {
            const current = overrides[a.name] || a.model || '';
            const isDirty = !!overrides[a.name] && overrides[a.name] !== a.model;
            const warn    = memoryWarnings[a.name];
            return (
              <div key={a.name} className={`swap-agent-row${isDirty ? ' dirty' : ''}`}>
                <span className="swap-agent-name">
                  {isDirty && <span className="swap-dirty-dot">●</span>}
                  {a.name}
                </span>
                <div className="swap-select-wrap">
                  <select
                    className={`swap-model-select${warn ? ' warn' : ''}`}
                    value={current}
                    onChange={e => handleChange(a.name, e.target.value)}
                  >
                    {Object.entries(grouped).map(([backend, mlist]) => (
                      <optgroup key={backend} label={backend.toUpperCase()}>
                        {mlist.map(m => (
                          <option key={m.path} value={m.path}>{m.name}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  {warn && <div className="swap-mem-warn">⚠ {warn}</div>}
                  <input
                    className="swap-extra-args"
                    type="text"
                    value={currentExtraArgs(a)}
                    onChange={e => handleExtraChange(a.name, e.target.value)}
                    placeholder="extra server flags e.g. -fit off"
                    title="Extra llama-server flags passed verbatim at launch"
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {status === 'deploying' && (
        <div className="swap-deploying">Redeploying… killing old servers and loading new models (~2 min)</div>
      )}

      {hasMemoryWarning && (
        <div className="swap-mem-banner">
          ⚠ One or more selected models are larger — Metal pool is ~28 GB. May cause OOM crash.
        </div>
      )}

      {error && <div className="swap-error">{error}</div>}
      {result && <ServerLayout servers={result.servers} />}

      {status !== 'loading' && status !== 'deploying' && agents.length > 0 && (
        <div className="swap-actions">
          <button
            className={`swarm-deploy-btn${dirtyCount > 0 ? ' swap-dirty-btn' : ''}`}
            onClick={handleRedeploy}
            disabled={status === 'deploying'}
          >
            {dirtyCount > 0
              ? `REDEPLOY (${dirtyCount} change${dirtyCount > 1 ? 's' : ''})`
              : 'REDEPLOY'}
          </button>
          {dirtyCount > 0 && (
            <button className="swap-reset-btn" onClick={() => { setOverrides({}); setExtraOverrides({}); setError(null); setResult(null); }}>
              Reset
            </button>
          )}
        </div>
      )}
    </div>
  );
}
