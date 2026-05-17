// Pure helpers and constants extracted from SwarmConfig.js.
// No React, no I/O — every export is deterministic given its inputs so it can
// be tested in isolation and reused by sibling modules (risk, deploy).

export const shortName = p => p.replace(/\.gguf$/, '').split('/').pop();

export const isAppleSilicon =
  typeof navigator !== 'undefined' && (
    navigator.platform === 'MacIntel' ||
    (navigator.userAgent.includes('Mac') && navigator.userAgent.includes('ARM'))
  );

export const ENGINES = [
  { id: 'llama', label: 'LLAMA', backend: 'llama' },
  { id: 'mlx',   label: 'MLX',   backend: 'mlx'   },
  { id: 'vllm',  label: 'vLLM',  backend: 'vllm'  },
];

export const PROFILE_SAFE     = 'safe';
export const PROFILE_BALANCED = 'balanced';
export const PROFILE_MAX      = 'max';
export const PROFILE_MIXED    = 'mixed';

export function getEngineLabel(engineId) {
  return ENGINES.find(e => e.id === engineId)?.label ?? engineId;
}

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

/**
 * Return the subset of agent names to activate for a given profile.
 *
 * roleContextMap:   { [agentName]: contextSize } — derived from live agent configs.
 * profileThresholds: { [profileId]: { max_context: number|null } } — from
 *   coordinator.profiles in swarm-config.json. Falls back to built-in defaults
 *   so the UI works even when the config key is absent.
 *
 *   safe     → agents with context <= max_context (default 2048)
 *   balanced → agents with context <= max_context (default 4096)
 *   max      → all agents (max_context: null means no filter)
 *   mixed    → all agents
 */
export function getProfileRoles(profileId, allRoles, roleContextMap = {}, profileThresholds = {}) {
  const DEFAULT_THRESHOLDS = { safe: 2048, balanced: 4096 };
  const thresholdEntry = profileThresholds[profileId];
  const maxCtx = thresholdEntry !== undefined
    ? thresholdEntry.max_context
    : DEFAULT_THRESHOLDS[profileId] ?? null;
  if (maxCtx === null || maxCtx === undefined) return allRoles;
  const filtered = allRoles.filter(name => (roleContextMap[name] ?? 0) <= maxCtx);
  // Always fall back to all roles if nothing passes the filter (avoids empty selection).
  return filtered.length > 0 ? filtered : allRoles;
}

// Roles that benefit from the largest available model.
const HEAVY_ROLES = new Set([
  'architect', 'programmer', 'debugger', 'optimizer', 'security', 'reviewer',
]);

/**
 * Choose the best model for a role from a pre-filtered list of candidates.
 *
 * availableModels should already be filtered to the correct backend by the caller.
 * Heavy roles (architect, programmer, …) get the largest model; light roles get smallest.
 * Tie-break: alphabetical by name.
 */
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
