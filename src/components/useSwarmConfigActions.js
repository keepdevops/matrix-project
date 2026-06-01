import { useCallback } from 'react';
import { invalidateModelsCache } from '../api/swarmApi';
import { getProfileRoles, chooseModelForRole } from './SwarmConfig.layoutHelpers';

/**
 * Action callbacks for the swarm configure panel.
 * Extracted from useSwarmConfigState to keep that hook under 150 LOC.
 */
export function useSwarmConfigActions({
  roles,
  models,
  engine,
  profileThresholds,
  editingAgent,
  setEngine,
  setSelected,
  setRoleModels,
  setActiveProfile,
  setLoadRetries,
  setRoles,
  reset,
}) {
  const handleEngineChange = useCallback(newEngine => {
    setEngine(newEngine);
    setSelected(new Set());
    setRoleModels({});
  }, [setEngine, setSelected, setRoleModels]);

  const toggleRole = useCallback(name => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, [setSelected]);

  const setModel = useCallback((name, model) => {
    setRoleModels(prev => ({ ...prev, [name]: model }));
  }, [setRoleModels]);

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
  }, [roles, models, engine, profileThresholds, setSelected, setRoleModels, setActiveProfile, reset]);

  const retryLoad = useCallback(() => {
    invalidateModelsCache();
    setLoadRetries(r => r + 1);
  }, [setLoadRetries]);

  const handleAgentSaved = useCallback((saved) => {
    const next = typeof saved === 'string' ? { system_prompt: saved } : (saved || {});
    setRoles(prev => prev.map(r =>
      (r.name === editingAgent?.name ? { ...r, ...next } : r)));
  }, [editingAgent, setRoles]);

  return {
    handleEngineChange,
    toggleRole,
    setModel,
    applyProfile,
    retryLoad,
    handleAgentSaved,
  };
}
