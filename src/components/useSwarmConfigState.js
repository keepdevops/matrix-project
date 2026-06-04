import { useState, useEffect, useMemo } from 'react';
import {
  fetchSwarmConfig,
  fetchModels,
  fetchAgents,
} from '../api/swarmApi';
import {
  PROFILE_SAFE,
  PROFILE_MAX,
} from './SwarmConfig.helpers';
import { computeLayout } from './SwarmConfig.layoutHelpers';
import { computeRiskEstimate } from './SwarmConfig.risk';
import { useSwarmConfigActions } from './useSwarmConfigActions';

const VLLM_PRESTARTED_PORTS = [
  { port: 8080, model: 'Qwen2.5-14B' },
  { port: 8081, model: 'Llama-3.2-3B' },
  { port: 8082, model: 'DeepSeek-Coder-V2' },
  { port: 8083, model: 'Phi-4-mini' },
];

/** Swarm configure panel state, effects, and derived layout/risk. */
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
        setEngine(running ? (running.engine || running.backend || 'llama') : 'llama');
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

  const riskEstimate = useMemo(
    () => computeRiskEstimate(roles, selected, roleModels, models),
    [roles, selected, roleModels, models],
  );

  const activeBackends = useMemo(() => Array.from(new Set(
    Object.values(roleModels)
      .map(path => models.find(m => m.path === path)?.backend)
      .filter(Boolean),
  )), [roleModels, models]);

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

  const actions = useSwarmConfigActions({
    roles, models, engine, profileThresholds, editingAgent,
    setEngine, setSelected, setRoleModels, setActiveProfile, setLoadRetries, setRoles,
    reset,
  });

  return {
    roles, setRoles,
    models, selected, roleModels, engine,
    loadError, activeProfile,
    editingAgent, setEditingAgent,
    engineModels, hasEngineModels,
    riskEstimate, layout, activeBackends,
    isMixedBackends: activeBackends.length > 1,
    canDeploy,
    ...actions,
  };
}
