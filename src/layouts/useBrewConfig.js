import { useState, useEffect, useMemo, useRef } from 'react';
import {
  fetchSwarmConfig, fetchModels, fetchAgents, invalidateModelsCache,
} from '../api/swarmApi';
import { PROFILE_CUSTOM, PROFILE_SAFE } from '../components/SwarmConfig.helpers';
import { computeLayout } from '../components/SwarmConfig.layoutHelpers';
import { computeRiskEstimate, RAM_WARN_GB } from '../components/SwarmConfig.risk';
import { useBrewRoleHandlers } from './useBrewRoleHandlers';

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

  const hostMemoryRef = useRef(hostMemory);
  useEffect(() => { hostMemoryRef.current = hostMemory; }, [hostMemory]);

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
        const mem = hostMemoryRef.current;
        const liveUsedGb = mem?.ok && Number.isFinite(mem.used_gb) ? mem.used_gb : null;
        const defaultProfile = liveUsedGb !== null && liveUsedGb > RAM_WARN_GB
          ? PROFILE_SAFE : (liveAgents.length > 0 ? PROFILE_CUSTOM : PROFILE_SAFE);
        setActiveProfile(defaultProfile);
      })
      .catch(e => { if (!cancelled) setLoadError(e.message); });
    return () => { cancelled = true; };
  }, [loadRetries]);

  const engineModels = useMemo(() => models.filter(m => m.backend === engine), [models, engine]);

  const handlers = useBrewRoleHandlers({
    roles, models, engine, engineModels, profileThresholds,
    setEngine, setSelected, setRoleModels, setActiveProfile,
  });

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
    engineModels, riskEstimate, serverLayout,
    canDeploy, agentCount, rosterPct, configLines,
    ...handlers,
  };
}
