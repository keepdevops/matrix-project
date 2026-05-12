import React, { useState, useEffect } from 'react';
import { fetchSwarmConfig, fetchModels, configureSwarm, fetchLogs, fetchAgents } from '../api/swarmApi';
import VllmPanel from './VllmPanel';

const shortName = p => p.replace(/\.gguf$/, '').split('/').pop();

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

const PROFILE_SAFE = 'safe';
const PROFILE_BALANCED = 'balanced';
const PROFILE_MAX = 'max';
const PROFILE_MIXED = 'mixed';

const SAFE_ROLES = ['foreman', 'tester', 'devops', 'scout', 'api', 'documenter'];
const BALANCED_ROLES = [...SAFE_ROLES, 'architect', 'programmer'];
const SAFE_ROLES_MLX = ['mlx-coder', 'foreman', 'documenter', 'api'];
const BALANCED_ROLES_MLX = [...SAFE_ROLES_MLX, 'architect', 'programmer', 'scout'];
const MIXED_ROLES = ['architect', 'programmer', 'foreman', 'scout', 'api', 'documenter', 'mlx-coder'];

function getEngineLabel(engineId) {
  return ENGINES.find(e => e.id === engineId)?.label ?? engineId;
}

function parseModelSizeBillions(modelPath) {
  const m = shortName(modelPath).match(/(\d+(?:\.\d+)?)b/i);
  return m ? Number(m[1]) : null;
}

function getModelWeight(modelPath, engine) {
  const sizeB = parseModelSizeBillions(modelPath);
  if (sizeB !== null) {
    if (sizeB <= 2.5) return 0.4;
    if (sizeB <= 3.5) return 0.55;
    if (sizeB <= 8.5) return 1.0;
    if (sizeB <= 14.5) return 1.4;
    return 1.8;
  }
  if (engine === 'vllm') return 1.1;
  if (engine === 'mlx') return 0.9;
  return 1.0;
}

function getRiskBand(totalScore) {
  if (totalScore > 18) return { id: 'high', label: 'HIGH', hint: 'Likely OOM on heavy prompts' };
  if (totalScore >= 12) return { id: 'medium', label: 'MEDIUM', hint: 'May OOM under flat/full parallel runs' };
  return { id: 'low', label: 'LOW', hint: 'Usually stable for normal prompts' };
}

function getProfileRoles(engineId, profileId, allRoles) {
  if (profileId === PROFILE_MIXED) return MIXED_ROLES;
  if (profileId === PROFILE_MAX) return allRoles;
  if (engineId === 'mlx') {
    return profileId === PROFILE_SAFE ? SAFE_ROLES_MLX : BALANCED_ROLES_MLX;
  }
  return profileId === PROFILE_SAFE ? SAFE_ROLES : BALANCED_ROLES;
}

function selectBestModel(candidates) {
  if (candidates.length === 0) return null;
  const ranked = [...candidates].sort((a, b) => {
    const sa = parseModelSizeBillions(a.path) ?? 999;
    const sb = parseModelSizeBillions(b.path) ?? 999;
    if (sa !== sb) return sa - sb;
    return shortName(a.path).localeCompare(shortName(b.path));
  });
  return ranked[0];
}

function chooseModelForRole(roleName, availableModels, preferredPattern) {
  if (!availableModels.length) return null;
  if (preferredPattern) {
    const preferred = availableModels.find(m => preferredPattern.test(shortName(m.path)));
    if (preferred) return preferred.path;
  }
  if (roleName === 'architect' || roleName === 'programmer') {
    const medium = selectBestModel(
      availableModels.filter(m => {
        const size = parseModelSizeBillions(m.path);
        return size !== null && size >= 6 && size <= 9;
      }),
    );
    if (medium) return medium.path;
  }
  return selectBestModel(availableModels)?.path || null;
}

function getPreferredBackends(profileId, roleName, activeEngine) {
  if (profileId !== PROFILE_MIXED) return [activeEngine];
  if (['mlx-coder', 'documenter', 'api'].includes(roleName)) return ['mlx', 'llama'];
  return ['llama', 'mlx'];
}

function getModelPattern(engineId, profileId, roleName) {
  if (profileId === PROFILE_MIXED) {
    if (['architect', 'programmer'].includes(roleName)) {
      return /(meta-llama.*8b|llama.*8b|granite.*8b|qwen.*7b|qwen.*8b)/i;
    }
    if (roleName === 'mlx-coder') return /(4bit|mlx|instruct)/i;
    if (roleName === 'documenter') return /(gemma.*2b|3b|mini)/i;
    return /(llama-?3\.2.*3b|3b|2b|mini)/i;
  }
  if (profileId === PROFILE_SAFE) {
    if (roleName === 'documenter') return /gemma.*2b/i;
    if (engineId === 'mlx') return /(3b|2b|mini)/i;
    if (engineId === 'vllm') return /(3b|2b|mini|phi)/i;
    return /llama-?3\.2.*3b/i;
  }
  if (profileId === PROFILE_BALANCED) {
    if (['architect', 'programmer'].includes(roleName)) {
      return /(meta-llama.*8b|llama.*8b|granite.*8b|qwen.*7b|qwen.*8b)/i;
    }
    if (roleName === 'documenter') return /gemma.*2b/i;
    if (engineId === 'mlx') return /(3b|2b|mini)/i;
    if (engineId === 'vllm') return /(3b|phi|mini|deepseek|coder)/i;
    return /llama-?3\.2.*3b/i;
  }
  return null;
}

function computeRiskEstimate(roles, selected, roleModels, models) {
  const groups = {};
  let readyAgents = 0;

  for (const role of roles) {
    if (!selected.has(role.name)) continue;
    const modelPath = roleModels[role.name];
    if (!modelPath) continue;
    readyAgents += 1;
    const modelMeta = models.find(m => m.path === modelPath);
    const agentEngine = modelMeta?.backend || role.backend || role.engine || 'llama';
    const key = `${agentEngine}:${modelPath}:${role.server_group || ''}`;
    const roleContext = Number(role.context) > 0 ? Number(role.context) : 2048;
    if (!groups[key]) {
      groups[key] = {
        key,
        engine: agentEngine,
        modelPath,
        modelLabel: shortName(modelPath),
        agents: [],
        maxContext: roleContext,
      };
    }
    groups[key].agents.push(role.name);
    groups[key].maxContext = Math.max(groups[key].maxContext, roleContext);
  }

  const computed = Object.values(groups).map(g => {
    const parallel = g.agents.length;
    const perAgentCtx = Math.min(g.maxContext, 8192);
    const rawCtx = perAgentCtx * parallel;
    const effectiveCtx = Math.min(rawCtx, 16384);
    const modelWeight = getModelWeight(g.modelPath, g.engine);
    const modelSizeB = parseModelSizeBillions(g.modelPath);
    const parallelWeight = 1 + (0.15 * Math.max(0, parallel - 1));
    const score = modelWeight * (effectiveCtx / 1024) * parallelWeight;
    const warnings = [];
    let riskLevel = 'ok';
    if (g.engine === 'llama' && effectiveCtx >= 12288) {
      warnings.push('high context load');
      riskLevel = 'warn';
    }
    if (rawCtx > 16384) {
      warnings.push('ctx capped to 16384');
      riskLevel = 'block';
    }
    if (g.engine === 'llama' && modelSizeB !== null && modelSizeB >= 8 && effectiveCtx >= 16384) {
      warnings.push('8B model at ctx cap');
      riskLevel = 'block';
    }
    if (g.engine === 'mlx') {
      if (modelSizeB !== null && modelSizeB >= 8 && parallel >= 3) {
        warnings.push('MLX 8B+ high parallel');
        riskLevel = 'block';
      } else if (parallel >= 4 || effectiveCtx >= 12288) {
        warnings.push('MLX high concurrency');
        riskLevel = riskLevel === 'block' ? 'block' : 'warn';
      }
    }
    if (g.engine === 'vllm') {
      if (modelSizeB !== null && modelSizeB >= 14 && parallel >= 2) {
        warnings.push('vLLM 14B+ high parallel');
        riskLevel = 'block';
      } else if ((modelSizeB !== null && modelSizeB >= 8 && effectiveCtx >= 8192) || parallel >= 3) {
        warnings.push('vLLM elevated memory load');
        riskLevel = riskLevel === 'block' ? 'block' : 'warn';
      }
    }
    return {
      ...g,
      parallel,
      perAgentCtx,
      effectiveCtx,
      rawCtx,
      modelSizeB,
      modelWeight,
      parallelWeight,
      score,
      warnings,
      riskLevel,
    };
  });

  const totalScore = computed.reduce((sum, g) => sum + g.score, 0);
  const blockedGroups = computed.filter(g => g.riskLevel === 'block');
  const warnGroups = computed.filter(g => g.riskLevel === 'warn');
  return {
    groups: computed.sort((a, b) => b.score - a.score),
    readyAgents,
    totalScore,
    band: getRiskBand(totalScore),
    blockedGroups,
    warnGroups,
  };
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
  const [activeProfile, setActiveProfile] = useState(PROFILE_SAFE);

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
        if (activeAgents.length > 0) {
          setActiveProfile(PROFILE_MAX);
        } else {
          setActiveProfile(PROFILE_SAFE);
        }
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
    setStatus('idle');
    setStatusMsg('');
    setLogTail(null);
  };

  const handleDeploy = async () => {
    if (riskEstimate.blockedGroups.length > 0) {
      const blocked = riskEstimate.blockedGroups.map(g => `${g.modelLabel} (ctx ${g.effectiveCtx})`).join(', ');
      setStatus('error');
      setStatusMsg(`Launch blocked: projected OOM risk is too high for ${blocked}. Reduce heavy groups, lower context, or switch to SAFE profile.`);
      return;
    }
    if (riskEstimate.band.id === 'high') {
      const ok = window.confirm(
        `Projected OOM risk is HIGH (score ${riskEstimate.totalScore.toFixed(1)}). Continue anyway?`,
      );
      if (!ok) return;
    }

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

  const riskEstimate = computeRiskEstimate(roles, selected, roleModels, models);
  const activeBackends = Array.from(new Set(
    Object.values(roleModels)
      .map(path => models.find(m => m.path === path)?.backend)
      .filter(Boolean),
  ));
  const isMixedBackends = activeBackends.length > 1;
  let layout = computeLayout(roles, selected, roleModels, models);

  // For vLLM: always show all 4 pre-started servers (8080-8083) even if no agents assigned
  if (engine === 'vllm') {
    const allVllmPorts = [
      { port: 8080, model: 'Mistral-Small-3.1-24B', agents: [], parallel: 0, engine: 'vllm' },
      { port: 8081, model: 'Meta-Llama-3.1-8B', agents: [], parallel: 0, engine: 'vllm' },
      { port: 8082, model: 'Codestral-22B', agents: [], parallel: 0, engine: 'vllm' },
      { port: 8083, model: 'phi-4', agents: [], parallel: 0, engine: 'vllm' },
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
                      : count === 0 ? `No ${e.label} models found in the configured model directory (MATRIX_MODEL_DIR)`
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
              <button
                className={`swarm-profile-btn ${activeProfile === PROFILE_SAFE ? 'active' : ''}`}
                onClick={() => applyProfile(PROFILE_SAFE)}
                type="button"
                title="Safe baseline: 4-6 lighter agents and smaller models"
              >
                SAFE
              </button>
              <button
                className={`swarm-profile-btn ${activeProfile === PROFILE_BALANCED ? 'active' : ''}`}
                onClick={() => applyProfile(PROFILE_BALANCED)}
                type="button"
                title="Balanced coding: adds architect+programmer with one medium/heavy cohort"
              >
                BALANCED
              </button>
              <button
                className={`swarm-profile-btn ${activeProfile === PROFILE_MAX ? 'active' : ''}`}
                onClick={() => applyProfile(PROFILE_MAX)}
                type="button"
                title="Max spread: select all available roles with smallest available llama models"
              >
                MAX
              </button>
              <button
                className={`swarm-profile-btn ${activeProfile === PROFILE_MIXED ? 'active' : ''}`}
                onClick={() => applyProfile(PROFILE_MIXED)}
                type="button"
                title="Mixed: llama for core coding roles, MLX for support roles when available"
              >
                MIXED
              </button>
            </div>
          </div>
          <div className="swarm-profile-note">
            Recommended daily default: <strong>SAFE</strong> (applies to current engine).
          </div>
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
          <div className={`swarm-risk-card risk-${riskEstimate.band.id}`}>
            <div className="swarm-risk-header">
              <span>OOM RISK ESTIMATE</span>
              <span className={`swarm-risk-badge risk-${riskEstimate.band.id}`}>{riskEstimate.band.label}</span>
            </div>
            <div className="swarm-risk-score">
              Score: <strong>{riskEstimate.totalScore.toFixed(1)}</strong> (yellow at 12, red at 18+)
            </div>
            {isMixedBackends && (
              <div className="swarm-risk-mixed">
                Mixed backend plan detected: {activeBackends.join(' + ')}
              </div>
            )}
            <div className="swarm-risk-hint">{riskEstimate.band.hint}</div>
            {riskEstimate.blockedGroups.length > 0 && (
              <div className="swarm-risk-block">
                Launch blocked: one or more groups exceed safe limits for {getEngineLabel(engine)}.
              </div>
            )}
            {riskEstimate.groups.length > 0 && (
              <div className="swarm-risk-groups">
                {riskEstimate.groups.map(g => (
                  <div key={g.key} className="swarm-risk-row">
                    <div className="swarm-risk-model">
                      <span>{g.modelLabel}</span>
                      <span className="swarm-risk-engine">[{g.engine}]</span>
                    </div>
                    <div className="swarm-risk-math">
                      ctx {g.perAgentCtx} x {g.parallel} -> {g.effectiveCtx}, score {g.score.toFixed(1)}
                    </div>
                    {g.warnings.length > 0 && (
                      <div className="swarm-risk-warn">{g.warnings.join(' - ')}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
            {riskEstimate.readyAgents === 0 && (
              <div className="swarm-risk-hint">Select agents and models to estimate memory pressure.</div>
            )}
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
