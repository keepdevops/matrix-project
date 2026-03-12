import React, { useState, useEffect } from 'react';
import { fetchSwarmConfig, fetchModels, configureSwarm } from '../api/swarmApi';

const shortName = p => p.split('/').pop().replace('.gguf', '');

// Compute VRAM layout from a selection of agents + their assigned models
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
      groups[port] = { model: shortName(model), agents: [] };
    }
    groups[port].agents.push(role.name);
  }

  return Object.entries(groups).map(([port, g]) => ({
    port: Number(port),
    model: g.model,
    agents: g.agents,
    parallel: g.agents.length,
  }));
}

export default function SwarmConfig({ onDeployed }) {
  const [roles, setRoles] = useState([]);
  const [models, setModels] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [roleModels, setRoleModels] = useState({});
  const [status, setStatus] = useState('idle'); // idle | deploying | error
  const [statusMsg, setStatusMsg] = useState('');
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    Promise.all([fetchSwarmConfig(), fetchModels()])
      .then(([config, modelList]) => {
        setRoles(config.agents);
        setModels(modelList);
        // Default: first 5 roles selected
        setSelected(new Set(config.agents.slice(0, 5).map(a => a.name)));
        const defaults = {};
        config.agents.forEach(a => { defaults[a.name] = a.model; });
        setRoleModels(defaults);
      })
      .catch(e => setLoadError(e.message));
  }, []);

  const toggleRole = name => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
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
    setStatusMsg('Starting model servers... this may take up to 120s');

    try {
      const result = await configureSwarm(agents);
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
          <code className="swarm-offline-cmd">bash scripts/run_matrix_pixi.sh</code>
          <div className="swarm-offline-detail">{loadError}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="swarm-config">
      <div className="swarm-config-columns">

        {/* Left: role list */}
        <div className="swarm-config-section">
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
                {selected.has(role.name) && models.length > 0 && (
                  <select
                    className="swarm-model-select"
                    value={roleModels[role.name] || role.model}
                    onChange={e => setModel(role.name, e.target.value)}
                  >
                    {models.map(m => (
                      <option key={m.path} value={m.path}>{m.name}</option>
                    ))}
                  </select>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Right: VRAM layout preview */}
        <div className="swarm-config-section">
          <div className="swarm-config-title">
            VRAM LAYOUT — {layout.length} server{layout.length !== 1 ? 's' : ''}, {selected.size} agent{selected.size !== 1 ? 's' : ''}
          </div>
          <div className="swarm-layout">
            {layout.map(s => (
              <div key={s.port} className="swarm-layout-row">
                <span className="layout-port">:{s.port}</span>
                <span className="layout-parallel">×{s.parallel}</span>
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
            disabled={selected.size === 0 || status === 'deploying'}
          >
            {status === 'deploying' ? 'LAUNCHING...' : 'LAUNCH SWARM'}
          </button>
        </div>

      </div>
    </div>
  );
}
