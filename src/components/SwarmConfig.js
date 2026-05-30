import React, { useState, useEffect } from 'react';
import Button from './Button';
import {
  fetchSwarmConfig,
  fetchModels,
  fetchAgents,
  invalidateModelsCache,
} from '../api/swarmApi';
import AgentPromptModal from './AgentPromptModal';
import SwarmAgentSelector from './SwarmAgentSelector';
import ServerLayoutPreview from './ServerLayoutPreview';
import {
  PROFILE_SAFE,
  PROFILE_MAX,
  computeLayout,
  getProfileRoles,
  chooseModelForRole,
} from './SwarmConfig.helpers';
import { computeRiskEstimate } from './SwarmConfig.risk';
import { useDeploy } from './SwarmConfig.deploy';

// Pre-started vLLM servers shown even when no agents are bound to a port.
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
  const [profileThresholds, setProfileThresholds] = useState({});
  const [editingAgent, setEditingAgent] = useState(null);

  const { status, statusMsg, logTail, agentStatuses, deploy, reset } = useDeploy({ onDeployed });

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

  const setModel = (name, model) => setRoleModels(prev => ({ ...prev, [name]: model }));

  const applyProfile = profileId => {
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

  const canDeploy = selected.size > 0 && Array.from(selected).some(n => roleModels[n]);

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
          <Button
            variant="outline-primary"
            size="md"
            style={{ marginTop: '1rem' }}
            onClick={() => { invalidateModelsCache(); setLoadRetries(r => r + 1); }}
          >
            RETRY
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="swarm-config">
      <div className="swarm-config-columns">
        <SwarmAgentSelector
          roles={roles}
          models={models}
          selected={selected}
          roleModels={roleModels}
          engine={engine}
          hasEngineModels={hasEngineModels}
          activeProfile={activeProfile}
          agentStatuses={agentStatuses}
          onEngineChange={handleEngineChange}
          onToggleRole={toggleRole}
          onSetModel={setModel}
          onApplyProfile={applyProfile}
          onEditAgent={setEditingAgent}
          onRolesChange={setRoles}
        />
        <ServerLayoutPreview
          layout={layout}
          engine={engine}
          riskEstimate={riskEstimate}
          isMixedBackends={isMixedBackends}
          activeBackends={activeBackends}
          selected={selected}
          status={status}
          statusMsg={statusMsg}
          logTail={logTail}
          onDeploy={() => deploy({ roles, selected, roleModels, models, engine, riskEstimate, layout })}
          canDeploy={canDeploy}
        />
      </div>

      {editingAgent && (
        <AgentPromptModal
          agent={editingAgent}
          defaultPrompt={editingAgent.system_prompt}
          onClose={() => setEditingAgent(null)}
          onSaved={(saved) => {
            const next = typeof saved === 'string' ? { system_prompt: saved } : (saved || {});
            setRoles(prev => prev.map(r =>
              r.name === editingAgent.name ? { ...r, ...next } : r));
          }}
        />
      )}
    </div>
  );
}
