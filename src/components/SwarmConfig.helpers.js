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

export const PROFILE_SAFE = 'safe';
export const PROFILE_BALANCED = 'balanced';
export const PROFILE_MAX = 'max';
export const PROFILE_MIXED = 'mixed';

export const SAFE_ROLES = ['foreman', 'tester', 'devops', 'scout', 'api', 'documenter'];
export const BALANCED_ROLES = [...SAFE_ROLES, 'architect', 'programmer'];
export const SAFE_ROLES_MLX = ['mlx-coder', 'foreman', 'documenter', 'api'];
export const BALANCED_ROLES_MLX = [...SAFE_ROLES_MLX, 'architect', 'programmer', 'scout'];
export const MIXED_ROLES = ['architect', 'programmer', 'foreman', 'scout', 'api', 'documenter', 'mlx-coder'];

export function getEngineLabel(engineId) {
  return ENGINES.find(e => e.id === engineId)?.label ?? engineId;
}

export function parseModelSizeBillions(modelPath) {
  const m = shortName(modelPath).match(/(\d+(?:\.\d+)?)b/i);
  return m ? Number(m[1]) : null;
}

export function getModelWeight(modelPath, engine) {
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

export function getRiskBand(totalScore) {
  if (totalScore > 18) return { id: 'high', label: 'HIGH', hint: 'Likely OOM on heavy prompts' };
  if (totalScore >= 12) return { id: 'medium', label: 'MEDIUM', hint: 'May OOM under flat/full parallel runs' };
  return { id: 'low', label: 'LOW', hint: 'Usually stable for normal prompts' };
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

export function getProfileRoles(engineId, profileId, allRoles) {
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

export function chooseModelForRole(roleName, availableModels, preferredPattern) {
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

export function getPreferredBackends(profileId, roleName, activeEngine) {
  if (profileId !== PROFILE_MIXED) return [activeEngine];
  if (['mlx-coder', 'documenter', 'api'].includes(roleName)) return ['mlx', 'llama'];
  return ['llama', 'mlx'];
}

export function getModelPattern(engineId, profileId, roleName) {
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
