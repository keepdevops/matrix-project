import React, { useState, useEffect } from 'react';
import { fetchSwarmConfig, fetchModels, configureSwarm, fetchLogs, fetchAgents } from '../api/swarmApi';
import VllmPanel from './VllmPanel';

const shortName = p => p.replace(/\.gguf$/, '').split('/').pop();
// A local MLX path is a filesystem path (starts with '/') that isn't a .gguf file.
// HuggingFace repo IDs like 'meta-llama/Llama-3.2-3B-Instruct' do NOT start with '/'.
const isMLXPath = p => p.startsWith('/') && !p.endsWith('.gguf');

// Detect if system is Apple Silicon (M-series)
const isAppleSilicon = navigator.platform === 'MacIntel' ||
  (navigator.userAgent.includes('Mac') && navigator.userAgent.includes('ARM'));

function computeLayout(roles, selected, roleModels, models) {
  const keyToPort = {};
  let nextPort = 8080;
  const groups = {};

  for (const role of roles) {
    if (!selected.has(role.name)) continue;
    const model = roleModels[role.name];
    if (!model) continue;
    const modelMeta = models.find(m => m.path === model);
    const agentEngine = modelMeta?.backend || role.backend || role.engine || 'llama';
    const key = `${agentEngine}:${model}:${role.server_group || ''}`;
    if (!keyToPort[key]) keyToPort[key] = nextPort++;
    const port = keyToPort[key];
    if (!groups[port]) {
      groups[port] = {
        model: shortName(model),
        agents: [],
        engine: agentEngine,
      };
    }
    groups[port].agents.push(role.name);
  }

  return Object.entries(groups).map(([port, g]) => ({
    port: Number(port),
    model: g.model,
    agents: g.agents,
    parallel: g.agents.length,
    engine: g.engine,
  }));
}

const ENGINES = [
  { id: 'llama',  label: 'LLAMA',  backend: 'llama'  },
  { id: 'mlx',   label: 'MLX',    backend: 'mlx'    },
  { id: 'vllm',  label: 'vLLM',   backend: 'vllm'   },
];

function getEngineLabel(engineId) {
  return ENGINES.find(e => e.id === engineId)?.label ?? engineId;
}

export default function SwarmConfig({ onDeployed }) {
  const [roles, setRoles] = useState([]);
  const [models, setModels] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [roleModels, setRoleModels] = useState({});
  const [engine, setEngine] = useState('llama');
  const [status, setStatus] = useState('idle');
  const [statusMsg, setStatusMsg] = useState('');
  const [loadError, setLoadError] = useState('');
  const [loadRetries, setLoadRetries] = useState(0);
  const [logTail, setLogTail] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoadError('');
    const activeAgentsPromise = fetchAgents().catch(e => {
      console.error('fetchAgents failed — rendering without running-swarm state:', e);
      return [];
    });
    Promise.all([fetchSwarmConfig(), fetchModels(), activeAgentsPromise])
      .then(([config, modelList, activeAgents]) => {
        if (cancelled) return;
        setRoles(config.agents);
        setModels(modelList);
        setSelected(new Set(activeAgents.map(a => a.name)));

        const running = activeAgents[0];
        const detectedEngine = running
          ? (running.engine || running.backend || 'llama')
          : 'llama';
        setEngine(detectedEngine);

        const preselected = {};
        activeAgents.forEach(a => { if (a.model) preselected[a.name] = a.model; });
        setRoleModels(preselected);
      })
      .catch(e => { if (!cancelled) setLoadError(e.message); });
    return () => { cancelled = true; };
  }, [loadRetries]);

  const engineModels = models.filter(m => m.backend === engine);
  const hasEngineModels = engineModels.length > 0;

  const handleEngineChange = newEngine => {
    setEngine(newEngine);
    setSelected(new Set());
    setRoleModels({});
  };

  const toggleRole = name => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const setModel = (name, model) => {
    setRoleModels(prev => ({ ...prev, [name]: model }));
  };

  const handleDeploy = async () => {
    const agents = roles
      .filter(r => selected.has(r.name))
      .map(r => {
        const model = roleModels[r.name];
        if (!model) return null;
        const modelMeta = models.find(m => m.path === model);
        const backend = modelMeta?.backend || r.backend || r.engine;
        return backend ? { ...r, model, backend } : { ...r, model };
      })
      .filter(Boolean);

    if (agents.length === 0) {
      setStatus('error');
      setStatusMsg('Select a model for at least one agent');
      return;
    }

    setStatus('deploying');
    const engineLabel = engine === 'mlx' ? 'MLX'
      : engine === 'vllm' ? 'vLLM'
      : 'llama-server';
    setStatusMsg(`Starting ${engineLabel} servers... this may take up to 4 minutes on first load`);

    setLogTail(null);
    try {
      await configureSwarm(agents);
      setStatus('idle');
      onDeployed();
    } catch (e) {
      setStatus('error');
      setStatusMsg(e.message);
      const ports = (e.failedPorts && e.failedPorts.length > 0) ? e.failedPorts : layout.map(s => s.port);
      if (ports.length > 0) {
        fetchLogs(ports).then(({ logs }) => setLogTail(logs)).catch(() => setLogTail([]));
      }
    }
  };

  let layout = computeLayout(roles, selected, roleModels, models);

  // For vLLM: always show all 4 pre-started servers (8080-8083) even if no agents assigned
  if (engine === 'vllm') {
    const existingPorts = new Set(layout.map(s => s.port));
    const allVllmPorts = [
      { port: 8080, model: 'Qwen2.5-14B', agents: [], parallel: 0, engine: 'vllm' },
      { port: 8081, model: 'Llama-3.2-3B', agents: [], parallel: 0, engine: 'vllm' },
      { port: 8082, model: 'DeepSeek-Coder-V2', agents: [], parallel: 0, engine: 'vllm' },
      { port: 8083, model: 'Phi-4-mini', agents: [], parallel: 0, engine: 'vllm' },
    ];
    // Merge: keep existing ports with their agents, fill in missing ports with empty entries
    const merged = allVllmPorts.map(vllm => {
      const existing = layout.find(s => s.port === vllm.port);
      return existing || vllm;
    });
    layout = merged;
  }

  if (loadError) {
    return (
      <div className="swarm-config">
        <div className="swarm-config-offline">
          <div className="swarm-offline-title">CONFIG UNAVAILABLE</div>
          <div className="swarm-offline-msg">
            Could not load swarm configuration. Start the proxy, then click Retry.
          </div>
          <code className="swarm-offline-cmd">bash scripts/launch_matrix.sh</code>
          <div className="swarm-offline-detail">{loadError}</div>
          <button
            className="swarm-deploy-btn"
            style={{ marginTop: '1rem' }}
            onClick={() => setLoadRetries(r => r + 1)}
          >
            RETRY
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="swarm-config">
      <div className="swarm-config-columns">

        {/* Left: engine selector + role list */}
        <div className="swarm-config-section">
          <div className="swarm-engine-row">
            <span className="swarm-engine-label">ENGINE</span>
            <div className="swarm-engine-toggle">
              {ENGINES.map(e => {
                const isAppleSiliconDisabled = isAppleSilicon && e.id === 'vllm';
                const count = models.filter(m => m.backend === e.backend).length;
                const isDisabled = count === 0 || isAppleSiliconDisabled;
                return (
                  <button
                    key={e.id}
                    className={`swarm-engine-btn engine-${e.id}${engine === e.id ? ' active' : ''}${isDisabled ? ' disabled' : ''}`}
                    onClick={() => !isDisabled && handleEngineChange(e.id)}
                    title={
                      isAppleSiliconDisabled ? `${e.label} requires NVIDIA GPU (not available on Apple Silicon)`
                      : count === 0 ? `No ${e.label} models found in /Users/Shared/llama/models/`
                      : `${count} model${count !== 1 ? 's' : ''} available`
                    }
                  >
                    {e.label}
                    <span className="engine-count">{count}</span>
                  </button>
                );
              })}
            </div>
            {hasEngineModels && (
              <span className="swarm-engine-in-use" title="Inference engine for this configuration">
                Using: <strong>{getEngineLabel(engine)}</strong>
              </span>
            )}
            {!hasEngineModels && (
              <span className="swarm-engine-warn">no models found</span>
            )}
          </div>

          <div className="swarm-config-title">SELECT AGENTS</div>
          <div className="swarm-roles-list">
            {roles.map(role => (
              <div
                key={role.name}
                className={`swarm-role-row ${selected.has(role.name) ? 'active' : ''}`}
              >
                <label
                  className="swarm-role-check"
                  title={role.name === 'mlx-coder' ? 'Apple Silicon optimized coding agent — pairs well with standard LLAMA agents for mixed swarms' : ''}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(role.name)}
                    onChange={() => toggleRole(role.name)}
                  />
                  <span className="swarm-role-name">{role.name}</span>
                </label>
                {selected.has(role.name) && models.length > 0 && (
                  <select
                    className="swarm-model-select"
                    value={roleModels[role.name] || ''}
                    onChange={e => setModel(role.name, e.target.value)}
                  >
                    <option value="" disabled>Select model…</option>
                    {Array.from(new Set(models.map(m => m.backend))).map(backend => (
                      <optgroup key={backend} label={backend}>
                        {models.filter(m => m.backend === backend).map(m => (
                          <option key={m.path} value={m.path}>{m.name}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Right: server layout preview */}
        <div className="swarm-config-section">
          <div className="swarm-config-title">
            SERVER LAYOUT — {getEngineLabel(engine)} · {layout.length} server{layout.length !== 1 ? 's' : ''}, {selected.size} agent{selected.size !== 1 ? 's' : ''}
          </div>
          <div className="swarm-layout">
            {layout.map(s => (
              <div key={s.port} className="swarm-layout-row">
                <span className="layout-port">:{s.port}</span>
                <span className={`layout-parallel layout-engine-${s.engine}`}>
                  {s.engine === 'mlx'    ? '[mlx]'
                  : s.engine === 'vllm'  ? '[vllm]'
                  : `×${s.parallel}`}
                </span>
                <div className="layout-right">
                  <div className="layout-agents">[{s.agents.join(', ')}]</div>
                  <div className="layout-model">{s.model}</div>
                </div>
              </div>
            ))}
            {layout.length === 0 && (
              <div className="layout-empty">Select at least one agent</div>
            )}
          </div>

          {engine === 'vllm' && <VllmPanel />}

          {status === 'error' && (
            <>
              <div className="swarm-config-error">{statusMsg}</div>
              {logTail && logTail.length > 0 && (
                <div className="swarm-config-logs">
                  <div className="swarm-config-logs-title">
                    Recent server logs (agent_logs/*.log)
                    {(engine === 'mlx' || engine === 'vllm') && ' — look for Python tracebacks or "No such file" above'}
                  </div>
                  {logTail.map(({ port, lines }) => (
                    <div key={port} className="swarm-config-log-block">
                      <div className="swarm-config-log-port">:{port}.log</div>
                      <pre className="swarm-config-log-pre">{lines.join('\n') || '(empty)'}</pre>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          {status === 'deploying' && (
            <div className="swarm-config-deploying">{statusMsg}</div>
          )}

          <button
            className={`swarm-deploy-btn ${status}`}
            onClick={handleDeploy}
            disabled={selected.size === 0 || status === 'deploying' || !Array.from(selected).some(n => roleModels[n])}
          >
            {status === 'deploying' ? 'LAUNCHING...' : 'LAUNCH SWARM'}
          </button>
        </div>

      </div>
    </div>
  );
}
