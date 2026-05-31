import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  fetchSwarmConfig, fetchModels, fetchAgents, invalidateModelsCache,
} from '../api/swarmApi';
import {
  PROFILE_CUSTOM, PROFILE_SAFE, computeLayout, getProfileRoles, chooseModelForRole,
} from '../components/SwarmConfig.helpers';
import { computeRiskEstimate, RAM_WARN_GB } from '../components/SwarmConfig.risk';

const VLLM_PRESTARTED = [
  { port: 8080, model: 'Qwen2.5-14B' },
  { port: 8081, model: 'Llama-3.2-3B' },
  { port: 8082, model: 'DeepSeek-Coder-V2' },
  { port: 8083, model: 'Phi-4-mini' },
];

function buildConfigLines(layout, selected) {
  const lines = ['swarm: {', `  agents: ${selected.size},`];
  layout.slice(0, 6).forEach(s => {
    const agents = s.agents?.slice(0, 2).join(', ') || '—';
    lines.push(`  :${s.port} ×${s.parallel} [${agents}]`);
    if (s.model) lines.push(`    model: ${s.model.split('/').pop()}`);
  });
  lines.push('}');
  return lines;
}

/** Encapsulates all configure-panel state, effects, and handlers. */
export function useBrewConfig({ online, activeAgents, hostMemory, activeMode }) {
  const [roles, setRoles]               = useState([]);
  const [models, setModels]             = useState([]);
  const [selected, setSelected]         = useState(new Set());
  const [roleModels, setRoleModels]     = useState({});
  const [engine, setEngine]             = useState('llama');
  const [activeProfile, setActiveProfile] = useState(PROFILE_CUSTOM);
  const [profileThresholds, setProfileThresholds] = useState({});
  const [editingAgent, setEditingAgent] = useState(null);
  const [loadError, setLoadError]       = useState('');
  const [loadRetries, setLoadRetries]   = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoadError('');
    const activeAgentsPromise = fetchAgents().catch(e => {
      console.error('useBrewConfig fetchAgents failed:', e);
      return [];
    });
    Promise.all([fetchSwarmConfig(), fetchModels(), activeAgentsPromise])
      .then(([config, modelList, liveAgents]) => {
        if (cancelled) return;
        setRoles(config.agents);
        if (config.coordinator?.profiles) setProfileThresholds(config.coordinator.profiles);
        setModels(modelList);
        setSelected(new Set(liveAgents.map(a => a.name)));
        const running = liveAgents[0];
        setEngine(running ? (running.engine || running.backend || 'llama') : 'llama');
        const preselected = {};
        liveAgents.forEach(a => { if (a.model) preselected[a.name] = a.model; });
        setRoleModels(preselected);
        const liveUsedGb = hostMemory?.ok && Number.isFinite(hostMemory.used_gb)
          ? hostMemory.used_gb : null;
        const defaultProfile = liveUsedGb !== null && liveUsedGb > RAM_WARN_GB
          ? PROFILE_SAFE
          : (liveAgents.length > 0 ? PROFILE_CUSTOM : PROFILE_SAFE);
        setActiveProfile(defaultProfile);
      })
      .catch(e => { if (!cancelled) setLoadError(e.message); });
    return () => { cancelled = true; };
  }, [loadRetries, hostMemory]);

  const engineModels = useMemo(() => models.filter(m => m.backend === engine), [models, engine]);

  const pickModelForRole = useCallback((roleName) => {
    const role = roles.find(r => r.name === roleName);
    const back = role?.engine || role?.backend || engine;
    const cands = models.filter(m => m.backend === back).length
      ? models.filter(m => m.backend === back) : engineModels;
    return chooseModelForRole(roleName, cands);
  }, [roles, models, engine, engineModels]);

  const handleEngineChange = useCallback(id => {
    setEngine(id);
    setSelected(new Set());
    setRoleModels({});
    setActiveProfile(PROFILE_CUSTOM);
  }, []);

  const toggleRole = useCallback(name => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
        const path = chooseModelForRole(name, models.filter(m => {
          const role = roles.find(r => r.name === name);
          const back = role?.engine || role?.backend || engine;
          return m.backend === back;
        }));
        if (path) setRoleModels(rm => ({ ...rm, [name]: path }));
      }
      return next;
    });
    setActiveProfile(PROFILE_CUSTOM);
  }, [models, roles, engine]);

  const setModel = useCallback((name, model) => {
    setRoleModels(prev => ({ ...prev, [name]: model }));
    setActiveProfile(PROFILE_CUSTOM);
  }, []);

  const selectAllRoles = useCallback(() => {
    const nextModels = {};
    roles.forEach(r => {
      const path = chooseModelForRole(r.name, models.filter(m => {
        const back = r.engine || r.backend || engine;
        return m.backend === back;
      }));
      if (path) nextModels[r.name] = path;
    });
    setRoleModels(prev => ({ ...prev, ...nextModels }));
    setSelected(new Set(roles.map(r => r.name)));
    setActiveProfile(PROFILE_CUSTOM);
  }, [roles, models, engine]);

  const clearAllRoles = useCallback(() => {
    setSelected(new Set());
    setActiveProfile(PROFILE_CUSTOM);
  }, []);

  // reset is the useDeploy reset — passed by caller to sync deploy state on profile change.
  const applyProfile = useCallback((profileId, reset) => {
    if (profileId === PROFILE_CUSTOM) { setActiveProfile(PROFILE_CUSTOM); return; }
    const roleMap   = new Map(roles.map(r => [r.name, r]));
    const ctxMap    = Object.fromEntries(roles.map(r => [r.name, r.context ?? 0]));
    const roleNames = getProfileRoles(profileId, roles.map(r => r.name), ctxMap, profileThresholds);
    const picked    = roleNames.filter(n => roleMap.has(n));
    const nextModels = {};
    for (const rn of picked) {
      const role = roleMap.get(rn);
      const back = role?.engine || role?.backend || engine;
      const cands = models.filter(m => m.backend === back).length
        ? models.filter(m => m.backend === back)
        : models.filter(m => m.backend === engine);
      const path = chooseModelForRole(rn, cands);
      if (path) nextModels[rn] = path;
    }
    setSelected(new Set(picked));
    setRoleModels(nextModels);
    setActiveProfile(profileId);
    reset?.();
  }, [roles, models, engine, profileThresholds]);

  const riskEstimate = useMemo(
    () => computeRiskEstimate(roles, selected, roleModels, models, hostMemory, activeMode),
    [roles, selected, roleModels, models, hostMemory, activeMode],
  );

  let serverLayout = useMemo(
    () => computeLayout(roles, selected, roleModels, models),
    [roles, selected, roleModels, models],
  );
  if (engine === 'vllm') {
    serverLayout = VLLM_PRESTARTED.map(({ port, model }) =>
      serverLayout.find(s => s.port === port) || { port, model, agents: [], parallel: 0, engine: 'vllm' }
    );
  }

  const canDeploy  = selected.size > 0 && Array.from(selected).some(n => roleModels[n]);
  const agentCount = selected.size;
  const rosterPct  = Math.min(100, (agentCount / Math.max(roles.length, 1)) * 100);
  const configLines = useMemo(() => buildConfigLines(serverLayout, selected), [serverLayout, selected]);

  return {
    roles, setRoles, models, selected, setSelected, roleModels, setRoleModels,
    engine, activeProfile, profileThresholds, editingAgent, setEditingAgent,
    loadError, setLoadError, loadRetries, setLoadRetries, invalidateModelsCache,
    engineModels, pickModelForRole, riskEstimate, serverLayout,
    canDeploy, agentCount, rosterPct, configLines,
    handleEngineChange, toggleRole, setModel, selectAllRoles, clearAllRoles, applyProfile,
  };
}
