import { shortName } from './SwarmConfig.helpers';
import { parseModelSizeBillions } from './SwarmConfig.layoutHelpers';

export function kvGbPer1kTokens(modelSizeB, engine) {
  if (engine === 'mlx')  return 0.08;
  if (engine === 'vllm') return 0.10;
  if (modelSizeB === null) return 0.06;
  if (modelSizeB >= 20)  return 0.13;
  if (modelSizeB >= 13)  return 0.08;
  if (modelSizeB >= 7)   return 0.04;
  return 0.02;
}

/** Build the agent → group map from selected roles + models. */
export function buildRiskGroups(roles, selected, roleModels, models) {
  const groups = {};
  let readyAgents = 0;
  for (const role of roles) {
    if (!selected.has(role.name)) continue;
    const modelPath = roleModels[role.name];
    if (!modelPath) continue;
    readyAgents += 1;
    const modelMeta   = models.find(m => m.path === modelPath);
    const agentEngine = modelMeta?.backend || role.backend || role.engine || 'llama';
    const key         = `${agentEngine}:${modelPath}:${role.server_group || ''}`;
    const roleContext = Number(role.context) > 0 ? Number(role.context) : 2048;
    if (!groups[key]) {
      groups[key] = { key, engine: agentEngine, modelPath,
        modelLabel: shortName(modelPath), agents: [], maxContext: roleContext };
    }
    groups[key].agents.push(role.name);
    groups[key].maxContext = Math.max(groups[key].maxContext, roleContext);
  }
  return { groups, readyAgents };
}

/** Score each group (KV GB, warnings, riskLevel). */
export function scoreGroups(groups, models) {
  return Object.values(groups).map(g => {
    const parallel    = g.agents.length;
    const perAgentCtx = g.maxContext;
    const rawCtx      = perAgentCtx * parallel;
    const modelSizeB  = parseModelSizeBillions(g.modelPath);
    const kvRate      = kvGbPer1kTokens(modelSizeB, g.engine);
    const kvGb        = (rawCtx / 1024) * kvRate;
    const warnings    = [];
    let   riskLevel   = 'ok';
    if (g.engine === 'mlx' && parallel >= 2) {
      warnings.push('MLX serializes requests — high latency under parallel load');
      riskLevel = 'warn';
    }
    if (g.engine === 'vllm' && modelSizeB !== null && modelSizeB >= 14 && parallel >= 3) {
      warnings.push('vLLM 14B+ high parallel');
      riskLevel = 'block';
    }
    return { ...g, parallel, perAgentCtx, effectiveCtx: rawCtx, rawCtx,
             modelSizeB, kvGb, score: kvGb, warnings, riskLevel };
  });
}

// Conservative Q4 bytes-per-parameter including metadata/header overhead
const Q4_GB_PER_B = 0.55;
const FALLBACK_SIZE_B = 8; // assume 8B when size can't be parsed

/**
 * Estimate model weight RAM for all engine groups.
 * Uses size_bytes from metadata when available, otherwise derives from
 * model size in billions via Q4 heuristic. Each group = one server instance,
 * so shared models (same path + engine) are counted once.
 */
export function modelWeightRam(groups, models) {
  return Object.values(groups).reduce((sum, g) => {
    const meta = models.find(m => m.path === g.modelPath);
    if (meta?.size_bytes > 0) return sum + meta.size_bytes / 1e9;
    const sizeB = parseModelSizeBillions(g.modelPath);
    return sum + (sizeB ?? FALLBACK_SIZE_B) * Q4_GB_PER_B;
  }, 0);
}

/** Sum MLX model weight RAM from size_bytes (kept for backward compat). */
export function mlxModelRam(groups, models) {
  return Object.values(groups)
    .filter(g => g.engine === 'mlx')
    .reduce((sum, g) => {
      const meta = models.find(m => m.path === g.modelPath);
      return sum + (meta?.size_bytes > 0 ? meta.size_bytes / 1e9 : 0);
    }, 0);
}
