import React, { useState, useEffect } from 'react';
import {
  fetchSwarmConfig,
  fetchModels,
  fetchAgents,
} from '../api/swarmApi';
import VllmPanel from './VllmPanel';
import ModeRosterPanel from './ModeRosterPanel';
import PresetsPanel from './PresetsPanel';
import {
  ENGINES,
  PROFILE_SAFE,
  PROFILE_BALANCED,
  PROFILE_MAX,
  PROFILE_MIXED,
  isAppleSilicon,
  computeLayout,
  getEngineLabel,
  getProfileRoles,
  getModelPattern,
  getPreferredBackends,
  chooseModelForRole,
} from './SwarmConfig.helpers';
import { computeRiskEstimate, RiskCard } from './SwarmConfig.risk';
import { useDeploy } from './SwarmConfig.deploy';

// Pre-started vLLM servers. Even when no agents are bound to a port, we want
// the UI to show the slot so users can see what's available.
const VLLM_PRESTARTED_PORTS = [
  { port: 8080, model: 'Qwen2.5-14B' },
  { port: 8081, model: 'Llama-3.2-3B' },
  { port: 8082, model: 'DeepSeek-Coder-V2' },
  { port: 8083, model: 'Phi-4-mini' },
];

export default function SwarmConfig({ onDeployed }) {
  const [roles, setRoles] = useState([]);
  const [models, setModels] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [roleModels, setRoleModels] = useState({});
  const [engine, setEngine] = useState('llama');
  const [loadError, setLoadError] = useState('');
  const [loadRetries, setLoadRetries] = useState(0);
  const [activeProfile, setActiveProfile] = useState(PROFILE_SAFE);

  const { status, statusMsg, logTail, deploy, reset } = useDeploy({ onDeployed });

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
        const detectedEngine = running ? (running.engine || running.backend || 'llama') : 'llama';
        setEngine(detectedEngine);

        const preselected = {};
        activeAgents.forEach(a => { if (a.model) preselected[a.name] = a.model; });
        setRoleModels(preselected);
        setActiveProfile(activeAgents.length > 0 ? PROFILE_MAX : PROFILE_SAFE);
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

  const applyProfile = profileId => {
    const engineModelsForProfile = models.filter(m => m.backend === engine);
    const roleMap = new Map(roles.map(r => [r.name, r]));
    const roleNames = getProfileRoles(engine, profileId, roles.map(r => r.name));
    const selectedNames = roleNames.filter(name => roleMap.has(name));
    const nextRoleModels = {};

    for (const roleName of selectedNames) {
      const preferredPattern = getModelPattern(engine, profileId, roleName);
      const backendOrder = getPreferredBackends(profileId, roleName, engine);
      let modelPath = null;
      for (const backendId of backendOrder) {
        const backendModels = models.filter(m => m.backend === backendId);
        modelPath = chooseModelForRole(
          roleName,
          profileId === PROFILE_MIXED ? backendModels : engineModelsForProfile,
          preferredPattern,
        );
        if (modelPath) break;
      }
      if (modelPath) nextRoleModels[roleName] = modelPath;
    }

    setSelected(new Set(selectedNames));
    setRoleModels(nextRoleModels);
    setActiveProfile(profileId);
    reset();
  };

  const riskEstimate = computeRiskEstimate(roles, selected, roleModels, models);
  const activeBackends = Array.from(new Set(
    Object.values(roleModels)
      .map(path => models.find(m => m.path === path)?.backend)
      .filter(Boolean),
  ));
  const isMixedBackends = activeBackends.length > 1;
  let layout = computeLayout(roles, selected, roleModels, models);

  if (engine === 'vllm') {
    layout = VLLM_PRESTARTED_PORTS.map(({ port, model }) =>
      layout.find(s => s.port === port) || { port, model, agents: [], parallel: 0, engine: 'vllm' }
    );
  }

  const handleDeploy = () => deploy({
    roles, selected, roleModels, models, engine, riskEstimate, layout,
  });

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
          <div className="swarm-profile-row">
            <span className="swarm-profile-label">PROFILE</span>
            <div className="swarm-profile-buttons">
              {[
                [PROFILE_SAFE, 'SAFE', 'Safe baseline: 4-6 lighter agents and smaller models'],
                [PROFILE_BALANCED, 'BALANCED', 'Balanced coding: adds architect+programmer with one medium/heavy cohort'],
                [PROFILE_MAX, 'MAX', 'Max spread: select all available roles with smallest available llama models'],
                [PROFILE_MIXED, 'MIXED', 'Mixed: llama for core coding roles, MLX for support roles when available'],
              ].map(([id, label, title]) => (
                <button
                  key={id}
                  className={`swarm-profile-btn ${activeProfile === id ? 'active' : ''}`}
                  onClick={() => applyProfile(id)}
                  type="button"
                  title={title}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="swarm-profile-note">
            Recommended daily default: <strong>SAFE</strong> (applies to current engine).
          </div>
          <div className="swarm-roles-list">
            {roles.map(role => (
              <div key={role.name}
                   className={`swarm-role-row ${selected.has(role.name) ? 'active' : ''}`}>
                <label className="swarm-role-check"
                       title={role.name === 'mlx-coder' ? 'Apple Silicon optimized coding agent — pairs well with standard LLAMA agents for mixed swarms' : ''}>
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

          <RiskCard
            riskEstimate={riskEstimate}
            engine={engine}
            isMixedBackends={isMixedBackends}
            activeBackends={activeBackends}
          />

          <div className="swarm-layout">
            {layout.map(s => (
              <div key={s.port} className="swarm-layout-row">
                <span className="layout-port">:{s.port}</span>
                <span className={`layout-parallel layout-engine-${s.engine}`}>
                  {s.engine === 'mlx' ? '[mlx]'
                  : s.engine === 'vllm' ? '[vllm]'
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

          <ModeRosterPanel />
          <PresetsPanel />

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
