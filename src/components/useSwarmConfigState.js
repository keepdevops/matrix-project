import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  fetchSwarmConfig,
  fetchModels,
  fetchAgents,
  invalidateModelsCache,
} from '../api/swarmApi';
import {
  PROFILE_SAFE,
  PROFILE_MAX,
  computeLayout,
  getProfileRoles,
  chooseModelForRole,
} from './SwarmConfig.helpers';
import { computeRiskEstimate } from './SwarmConfig.risk';

const VLLM_PRESTARTED_PORTS = [
  { port: 8080, model: 'Qwen2.5-14B' },
  { port: 8081, model: 'Llama-3.2-3B' },
  { port: 8082, model: 'DeepSeek-Coder-V2' },
  { port: 8083, model: 'Phi-4-mini' },
];

/** Swarm configure panel state, effects, handlers, and derived layout/risk. */
export function useSwarmConfigState({ reset }) {
  const [roles, setRoles] = useState([]);
  const [models, setModels] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [roleModels, setRoleModels] = useState({});
  const [engine, setEngine] = useState('llama');
  const [loadError, setLoadError] = useState('');
  const [loadRetries, setLoadRetries] = useState(0);
  const [activeProfile, setActiveProfile] = useState(PROFILE_SAFE);
  const [profileThresholds, setProfileThresholds] = useState({});
  const [editingAgent, setEditingAgent] = useState(null);

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
        if (config.coordinator?.profiles) setProfileThresholds(config.coordinator.profiles);
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

  const engineModels = useMemo(() => models.filter(m => m.backend === engine), [models, engine]);
  const hasEngineModels = engineModels.length > 0;

  const handleEngineChange = useCallback(newEngine => {
    setEngine(newEngine);
    setSelected(new Set());
    setRoleModels({});
  }, []);

  const toggleRole = useCallback(name => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const setModel = useCallback((name, model) => {
    setRoleModels(prev => ({ ...prev, [name]: model }));
  }, []);

  const applyProfile = useCallback(profileId => {
    const roleMap = new Map(roles.map(r => [r.name, r]));
    const roleContextMap = Object.fromEntries(roles.map(r => [r.name, r.context ?? 0]));
    const roleNames = getProfileRoles(profileId, roles.map(r => r.name), roleContextMap, profileThresholds);
    const selectedNames = roleNames.filter(name => roleMap.has(name));
    const nextRoleModels = {};
    for (const roleName of selectedNames) {
      const role = roleMap.get(roleName);
      const backend = role?.engine || role?.backend || engine;
      const backendModels = models.filter(m => m.backend === backend);
      const candidates = backendModels.length ? backendModels : models.filter(m => m.backend === engine);
      const modelPath = chooseModelForRole(roleName, candidates);
      if (modelPath) nextRoleModels[roleName] = modelPath;
    }
    setSelected(new Set(selectedNames));
    setRoleModels(nextRoleModels);
    setActiveProfile(profileId);
    reset?.();
  }, [roles, models, engine, profileThresholds, reset]);

  const riskEstimate = useMemo(
    () => computeRiskEstimate(roles, selected, roleModels, models),
    [roles, selected, roleModels, models],
  );

  const activeBackends = useMemo(() => Array.from(new Set(
    Object.values(roleModels)
      .map(path => models.find(m => m.path === path)?.backend)
      .filter(Boolean),
  )), [roleModels, models]);

  const isMixedBackends = activeBackends.length > 1;

  let layout = useMemo(
    () => computeLayout(roles, selected, roleModels, models),
    [roles, selected, roleModels, models],
  );

  if (engine === 'vllm') {
    layout = VLLM_PRESTARTED_PORTS.map(({ port, model }) =>
      layout.find(s => s.port === port) || { port, model, agents: [], parallel: 0, engine: 'vllm' }
    );
  }

  const canDeploy = selected.size > 0 && Array.from(selected).some(n => roleModels[n]);

  const retryLoad = useCallback(() => {
    invalidateModelsCache();
    setLoadRetries(r => r + 1);
  }, []);

  const handleAgentSaved = useCallback((saved) => {
    const next = typeof saved === 'string' ? { system_prompt: saved } : (saved || {});
    setRoles(prev => prev.map(r =>
      (r.name === editingAgent?.name ? { ...r, ...next } : r)));
  }, [editingAgent]);

  return {
    roles,
    setRoles,
    models,
    selected,
    roleModels,
    engine,
    loadError,
    activeProfile,
    editingAgent,
    setEditingAgent,
    engineModels,
    hasEngineModels,
    handleEngineChange,
    toggleRole,
    setModel,
    applyProfile,
    riskEstimate,
    layout,
    activeBackends,
    isMixedBackends,
    canDeploy,
    retryLoad,
    handleAgentSaved,
  };
}
