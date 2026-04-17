import React, { useState, useEffect } from 'react';
import { fetchSwarmConfig, fetchModels, configureSwarm, fetchLogs } from '../api/swarmApi';
import VllmPanel from './VllmPanel';

const shortName = p => p.replace(/\.gguf$/, '').split('/').pop();
// A local MLX path is a filesystem path (starts with '/') that isn't a .gguf file.
// HuggingFace repo IDs like 'meta-llama/Llama-3.2-3B-Instruct' do NOT start with '/'.
const isMLXPath = p => p.startsWith('/') && !p.endsWith('.gguf');

const DOCKER_PORT = 12434;

function computeLayout(roles, selected, roleModels, engine) {
  const keyToPort = {};
  let nextPort = 8080;
  const groups = {};

  for (const role of roles) {
    if (!selected.has(role.name)) continue;
    const model = roleModels[role.name] || role.model;
    // Docker Model Runner: one shared endpoint regardless of model
    const key = engine === 'docker' ? 'docker:shared'
      : `${engine}:${model}:${role.server_group || ''}`;
    if (!keyToPort[key]) keyToPort[key] = engine === 'docker' ? DOCKER_PORT : nextPort++;
    const port = keyToPort[key];
    if (!groups[port]) {
      groups[port] = {
        model: shortName(model),
        agents: [],
        engine,
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
  { id: 'docker', label: 'DOCKER', backend: 'docker' },
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
    Promise.all([fetchSwarmConfig(), fetchModels()])
      .then(([config, modelList]) => {
        if (cancelled) return;
        setRoles(config.agents);
        setModels(modelList);
        const DEFAULT_AGENTS = new Set(['architect', 'programmer', 'specialist', 'reviewer', 'synthesis']);
        const selectedNames = new Set(config.agents.filter(a => DEFAULT_AGENTS.has(a.name)).map(a => a.name));
        setSelected(selectedNames);
        const defaults = {};
        config.agents.forEach(a => { defaults[a.name] = a.model; });

        // Detect engine from backend field or local path shape
        const firstAgent = config.agents[0];
        const firstBackend = firstAgent?.backend;
        const firstModel = firstAgent?.model;
        const detectedEngine =
          firstBackend === 'mlx'    ? 'mlx'
          : firstBackend === 'vllm'   ? 'vllm'
          : firstBackend === 'docker' ? 'docker'
          : (firstModel && isMLXPath(firstModel)) ? 'mlx'
          : 'llama';
        setEngine(detectedEngine);

        // If the stored models are not local paths (e.g. HF repo IDs from a docker-vllm config),
        // remap each selected agent to the best available local model for the detected engine.
        const engineModelsNow = modelList.filter(m => m.backend === detectedEngine);
        const hasNonLocalModels = config.agents.some(a => selectedNames.has(a.name) && !a.model.startsWith('/'));

        // For vLLM: always map by server_group to fixed ports (8080/8081/8082/8083)
        // even if no vLLM models detected, since servers are pre-started infrastructure
        if (detectedEngine === 'vllm' && hasNonLocalModels) {
          const vllmFallback = engineModelsNow.length > 0 ? engineModelsNow[0] : modelList[0];
          if (vllmFallback) {
            config.agents.forEach(a => {
              if (!selectedNames.has(a.name)) return;
              defaults[a.name] = vllmFallback.path;
            });
          }
        } else if (hasNonLocalModels && engineModelsNow.length > 0) {
          // Generic remapping for other engines
          const oldModelToNew = {};
          let idx = 0;
          config.agents.forEach(a => {
            if (!selectedNames.has(a.name)) return;
            if (!(a.model in oldModelToNew)) {
              oldModelToNew[a.model] = engineModelsNow[idx % engineModelsNow.length].path;
              idx++;
            }
            defaults[a.name] = oldModelToNew[a.model];
          });
        }
        setRoleModels(defaults);
      })
      .catch(e => { if (!cancelled) setLoadError(e.message); });
    return () => { cancelled = true; };
  }, [loadRetries]);

  const engineModels = models.filter(m => m.backend === engine);
  const hasEngineModels = engineModels.length > 0;

  const handleEngineChange = newEngine => {
    setEngine(newEngine);
    const available = models.filter(m => m.backend === newEngine);
    // For vLLM: always map by server_group to fixed ports (8080/8081/8082/8083)
    // even if no vLLM models are detected, since the servers are pre-started infrastructure
    if (newEngine === 'vllm') {
      // Use any available vLLM model as fallback, or first available model if none
      const vllmFallback = available.length > 0 ? available[0] : models[0];
      if (!vllmFallback) return;
      const groupToPort = {
        llama8b: 8080,
        granite8b: 8081,
        llama3b: 8082,
        gemma2b: 8083,
      };
      setRoleModels(prev => {
        const next = { ...prev };
        roles.forEach(r => {
          if (!selected.has(r.name)) return;
          next[r.name] = vllmFallback.path;
        });
        return next;
      });
      return;
    }
    if (!available.length) return;
    // Generic remapping for other engines
    setRoleModels(prev => {
      const next = { ...prev };
      const oldModelToNew = {};
      let idx = 0;
      roles.forEach(r => {
        if (!selected.has(r.name)) return;
        const oldModel = prev[r.name] || r.model;
        if (!(oldModel in oldModelToNew)) {
          oldModelToNew[oldModel] = available[idx % available.length].path;
          idx++;
        }
        next[r.name] = oldModelToNew[oldModel];
      });
      return next;
    });
  };

  const toggleRole = name => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
        // Only override model if the current one doesn't match the active engine
        if (hasEngineModels) {
          const currentModel = roleModels[name];
          const matchesEngine = currentModel && (
            engine === 'llama' ? !isMLXPath(currentModel) : isMLXPath(currentModel)
          );
          if (!matchesEngine) {
            // Prefer the same engine model already assigned to a peer agent
            // sharing the same swarm-config default model (keeps grouping intact).
            // Fall back to the first unused engine model to avoid collapsing to one port.
            const agentDefault = roles.find(r => r.name === name)?.model;
            const peerModel = roles
              .filter(r => selected.has(r.name) && r.model === agentDefault)
              .map(r => roleModels[r.name])
              .find(p => p && (engine === 'llama' ? !isMLXPath(p) : isMLXPath(p)));
            const usedPaths = new Set(
              roles.filter(r => selected.has(r.name)).map(r => roleModels[r.name])
            );
            const unused = engineModels.find(m => !usedPaths.has(m.path));
            setRoleModels(m => ({ ...m, [name]: peerModel || (unused || engineModels[0]).path }));
          }
        }
      }
      return next;
    });
  };

  const setModel = (name, model) => {
    setRoleModels(prev => ({ ...prev, [name]: model }));
  };

  const handleDeploy = async () => {
    const agents = roles
      .filter(r => selected.has(r.name))
      .map(r => ({ ...r, model: roleModels[r.name] || r.model, backend: engine }));

    setStatus('deploying');
    const engineLabel = engine === 'mlx' ? 'MLX'
      : engine === 'vllm' ? 'vLLM'
      : engine === 'docker' ? 'Docker Model Runner'
      : 'llama-server';
    const deployMsg = engine === 'docker'
      ? 'Connecting to Docker Model Runner (port 12434)...'
      : `Starting ${engineLabel} servers... this may take up to 4 minutes on first load`;
    setStatusMsg(deployMsg);

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

  let layout = computeLayout(roles, selected, roleModels, engine);

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
                const count = models.filter(m => m.backend === e.backend).length;
                return (
                  <button
                    key={e.id}
                    className={`swarm-engine-btn engine-${e.id}${engine === e.id ? ' active' : ''}${count === 0 ? ' disabled' : ''}`}
                    onClick={() => count > 0 && handleEngineChange(e.id)}
                    title={count === 0 ? `No ${e.label} models found in /Users/Shared/llama/models/` : `${count} model${count !== 1 ? 's' : ''} available`}
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
                <label className="swarm-role-check">
                  <input
                    type="checkbox"
                    checked={selected.has(role.name)}
                    onChange={() => toggleRole(role.name)}
                  />
                  <span className="swarm-role-name">{role.name}</span>
                </label>
                {selected.has(role.name) && engineModels.length > 0 && (
                  <select
                    className="swarm-model-select"
                    value={roleModels[role.name] || engineModels[0]?.path || ''}
                    onChange={e => setModel(role.name, e.target.value)}
                  >
                    {engineModels.map(m => (
                      <option key={m.path} value={m.path}>{m.name}</option>
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
                  : s.engine === 'docker' ? '[docker]'
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
                    {engine === 'docker' && ' — verify Docker Desktop is running and model is loaded (docker model run)'}
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
            disabled={selected.size === 0 || status === 'deploying' || !hasEngineModels}
          >
            {status === 'deploying' ? 'LAUNCHING...' : 'LAUNCH SWARM'}
          </button>
        </div>

      </div>
    </div>
  );
}
