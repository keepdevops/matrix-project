import { useCallback } from 'react';
import {
  PROFILE_CUSTOM, getProfileRoles, chooseModelForRole,
} from '../components/SwarmConfig.helpers';

export function useBrewRoleHandlers({
  roles, models, engine, engineModels, profileThresholds,
  setEngine, setSelected, setRoleModels, setActiveProfile,
}) {
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
  }, [setEngine, setSelected, setRoleModels, setActiveProfile]);

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
  }, [models, roles, engine, setSelected, setRoleModels, setActiveProfile]);

  const setModel = useCallback((name, model) => {
    setRoleModels(prev => ({ ...prev, [name]: model }));
    setActiveProfile(PROFILE_CUSTOM);
  }, [setRoleModels, setActiveProfile]);

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
  }, [roles, models, engine, setRoleModels, setSelected, setActiveProfile]);

  const clearAllRoles = useCallback(() => {
    setSelected(new Set());
    setActiveProfile(PROFILE_CUSTOM);
  }, [setSelected, setActiveProfile]);

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
  }, [roles, models, engine, profileThresholds, setSelected, setRoleModels, setActiveProfile]);

  return {
    pickModelForRole, handleEngineChange, toggleRole,
    setModel, selectAllRoles, clearAllRoles, applyProfile,
  };
}
