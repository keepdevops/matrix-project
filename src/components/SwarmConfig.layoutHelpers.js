import { shortName } from './SwarmConfig.helpers';

export function parseModelSizeBillions(modelPath) {
  const m = shortName(modelPath).match(/(\d+(?:\.\d+)?)b/i);
  return m ? Number(m[1]) : null;
}

export function computeLayout(roles, selected, roleModels, models) {
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
      groups[port] = { model: shortName(model), agents: [], engine: agentEngine };
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

export function getProfileRoles(profileId, allRoles, roleContextMap = {}, profileThresholds = {}) {
  const DEFAULT_THRESHOLDS = { safe: 2048, balanced: 4096 };
  const thresholdEntry = profileThresholds[profileId];
  const maxCtx = thresholdEntry !== undefined
    ? thresholdEntry.max_context
    : DEFAULT_THRESHOLDS[profileId] ?? null;
  if (maxCtx === null || maxCtx === undefined) return allRoles;
  const filtered = allRoles.filter(name => (roleContextMap[name] ?? 0) <= maxCtx);
  return filtered.length > 0 ? filtered : allRoles;
}

const HEAVY_ROLES = new Set([
  'architect', 'programmer', 'debugger', 'optimizer', 'security', 'reviewer',
]);

export function chooseModelForRole(roleName, availableModels) {
  if (!availableModels.length) return null;
  const heavy = HEAVY_ROLES.has(roleName);
  const sorted = [...availableModels].sort((a, b) => {
    const sa = parseModelSizeBillions(a.path) ?? (heavy ? 0 : 999);
    const sb = parseModelSizeBillions(b.path) ?? (heavy ? 0 : 999);
    if (sa !== sb) return heavy ? sb - sa : sa - sb;
    return shortName(a.path).localeCompare(shortName(b.path));
  });
  return sorted[0]?.path ?? null;
}
