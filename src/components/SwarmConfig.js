import React, { useState, useEffect } from 'react';
import { fetchSwarmConfig, fetchModels, configureSwarm } from '../api/swarmApi';

const shortName = p => p.replace(/\.gguf$/, '').split('/').pop();
const isMLXPath = p => !p.endsWith('.gguf');

function computeLayout(roles, selected, roleModels) {
  const modelToPort = {};
  let nextPort = 8080;
  const groups = {};

  for (const role of roles) {
    if (!selected.has(role.name)) continue;
    const model = roleModels[role.name] || role.model;
    if (!modelToPort[model]) modelToPort[model] = nextPort++;
    const port = modelToPort[model];
    if (!groups[port]) {
      groups[port] = { model: shortName(model), agents: [], mlx: isMLXPath(model) };
    }
    groups[port].agents.push(role.name);
  }

  return Object.entries(groups).map(([port, g]) => ({
    port: Number(port),
    model: g.model,
    agents: g.agents,
    parallel: g.agents.length,
    mlx: g.mlx,
  }));
}

const ENGINES = [
  { id: 'llama', label: 'LLAMA', backend: 'llama' },
  { id: 'mlx',   label: 'MLX',   backend: 'mlx'   },
];

export default function SwarmConfig({ onDeployed }) {
  const [roles, setRoles] = useState([]);
  const [models, setModels] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [roleModels, setRoleModels] = useState({});
  const [engine, setEngine] = useState('llama');
  const [status, setStatus] = useState('idle');
  const [statusMsg, setStatusMsg] = useState('');
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    Promise.all([fetchSwarmConfig(), fetchModels()])
      .then(([config, modelList]) => {
        setRoles(config.agents);
        setModels(modelList);
        const DEFAULT_AGENTS = new Set(['architect', 'programmer', 'specialist', 'reviewer', 'synthesis']);
        setSelected(new Set(config.agents.filter(a => DEFAULT_AGENTS.has(a.name)).map(a => a.name)));
        const defaults = {};
        config.agents.forEach(a => { defaults[a.name] = a.model; });
        setRoleModels(defaults);
        // Set initial engine from first default model type
        const firstDefault = config.agents[0]?.model;
        if (firstDefault && isMLXPath(firstDefault)) setEngine('mlx');
      })
      .catch(e => setLoadError(e.message));
  }, []);

  const engineModels = models.filter(m => m.backend === engine);
  const hasEngineModels = engineModels.length > 0;

  const handleEngineChange = newEngine => {
    setEngine(newEngine);
    const available = models.filter(m => m.backend === newEngine);
    if (!available.length) return;
    // Reset all selected agents to the first available model of the new engine
    setRoleModels(prev => {
      const next = { ...prev };
      roles.forEach(r => {
        if (selected.has(r.name)) next[r.name] = available[0].path;
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
          const matchesEngine = currentModel && (engine === 'mlx' ? isMLXPath(currentModel) : !isMLXPath(currentModel));
          if (!matchesEngine) {
            setRoleModels(m => ({ ...m, [name]: engineModels[0].path }));
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
      .map(r => ({ ...r, model: roleModels[r.name] || r.model }));

    setStatus('deploying');
    const engineLabel = engine === 'mlx' ? 'MLX' : 'llama-server';
    setStatusMsg(`Starting ${engineLabel} servers... this may take up to 120s`);

    try {
      await configureSwarm(agents);
      setStatus('idle');
      onDeployed();
    } catch (e) {
      setStatus('error');
      setStatusMsg(e.message);
    }
  };

  const layout = computeLayout(roles, selected, roleModels);

  if (loadError) {
    return (
      <div className="swarm-config">
        <div className="swarm-config-offline">
          <div className="swarm-offline-title">BACKEND UNREACHABLE</div>
          <div className="swarm-offline-msg">
            The proxy is not running. Start it from a terminal, then reload the page.
          </div>
          <code className="swarm-offline-cmd">bash scripts/launch_matrix.sh</code>
          <div className="swarm-offline-detail">{loadError}</div>
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
                    className={`swarm-engine-btn${engine === e.id ? ' active' : ''}${count === 0 ? ' disabled' : ''}`}
                    onClick={() => count > 0 && handleEngineChange(e.id)}
                    title={count === 0 ? `No ${e.label} models found in /Users/Shared/llama/models/` : `${count} model${count !== 1 ? 's' : ''} available`}
                  >
                    {e.label}
                    <span className="engine-count">{count}</span>
                  </button>
                );
              })}
            </div>
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
            SERVER LAYOUT — {layout.length} server{layout.length !== 1 ? 's' : ''}, {selected.size} agent{selected.size !== 1 ? 's' : ''}
          </div>
          <div className="swarm-layout">
            {layout.map(s => (
              <div key={s.port} className="swarm-layout-row">
                <span className="layout-port">:{s.port}</span>
                <span className={`layout-parallel${s.mlx ? ' layout-mlx' : ''}`}>
                  {s.mlx ? '[mlx]' : `×${s.parallel}`}
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

          {status === 'error' && (
            <div className="swarm-config-error">{statusMsg}</div>
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
