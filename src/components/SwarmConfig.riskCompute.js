import {
  shortName,
  parseModelSizeBillions,
} from './SwarmConfig.helpers';
import { getModeMemoryWeight } from '../utils/modeManifest';

export const RAM_TOTAL_GB   = 36;
export const RAM_MODEL_GB   = 17;
export const RAM_OS_GB      = 4;
export const RAM_BLOCK_GB   = 33;
export const RAM_WARN_GB    = 28;

function kvGbPer1kTokens(modelSizeB, engine) {
  if (engine === 'mlx')  return 0.08;
  if (engine === 'vllm') return 0.10;
  if (modelSizeB === null) return 0.06;
  if (modelSizeB >= 20)  return 0.13;
  if (modelSizeB >= 13)  return 0.08;
  if (modelSizeB >= 7)   return 0.04;
  return 0.02;
}

export function getRiskBand(totalRamGb) {
  if (totalRamGb > RAM_BLOCK_GB) return { id: 'high',   label: 'HIGH',   hint: 'Projected OOM — reduce agents or context' };
  if (totalRamGb > RAM_WARN_GB)  return { id: 'medium', label: 'MEDIUM', hint: 'Elevated memory pressure — watch for slowdowns' };
  return                                { id: 'low',    label: 'LOW',    hint: 'Well within 36GB memory budget' };
}

export function riskBandId(band) {
  if (!band) return 'low';
  return typeof band === 'object' ? band.id : band;
}

export function riskBandLabel(band) {
  if (!band) return 'LOW';
  return typeof band === 'object' ? band.label : String(band).toUpperCase();
}

export function computeRiskEstimate(roles, selected, roleModels, models, hostMemory = null, activeMode = null) {
  const groups = {};
  let readyAgents = 0;

  for (const role of roles) {
    if (!selected.has(role.name)) continue;
    const modelPath = roleModels[role.name];
    if (!modelPath) continue;
    readyAgents += 1;
    const modelMeta = models.find(m => m.path === modelPath);
    const agentEngine = modelMeta?.backend || role.backend || role.engine || 'llama';
    const key = `${agentEngine}:${modelPath}:${role.server_group || ''}`;
    const roleContext = Number(role.context) > 0 ? Number(role.context) : 2048;
    if (!groups[key]) {
      groups[key] = {
        key, engine: agentEngine, modelPath,
        modelLabel: shortName(modelPath),
        agents: [], maxContext: roleContext,
      };
    }
    groups[key].agents.push(role.name);
    groups[key].maxContext = Math.max(groups[key].maxContext, roleContext);
  }

  const mlxModelRamGb = Object.values(groups)
    .filter(g => g.engine === 'mlx')
    .reduce((sum, g) => {
      const meta = models.find(m => m.path === g.modelPath);
      return sum + (meta?.size_bytes > 0 ? meta.size_bytes / 1e9 : 0);
    }, 0);

  const computed = Object.values(groups).map(g => {
    const parallel    = g.agents.length;
    const perAgentCtx = g.maxContext;
    const rawCtx      = perAgentCtx * parallel;
    const modelSizeB  = parseModelSizeBillions(g.modelPath);
    const kvRate      = kvGbPer1kTokens(modelSizeB, g.engine);
    const kvGb        = (rawCtx / 1024) * kvRate;

    const warnings  = [];
    let riskLevel   = 'ok';

    if (g.engine === 'mlx' && parallel >= 2) {
      warnings.push('MLX serializes requests — high latency under parallel load');
      riskLevel = 'warn';
    }
    if (g.engine === 'vllm' && modelSizeB !== null && modelSizeB >= 14 && parallel >= 3) {
      warnings.push('vLLM 14B+ high parallel');
      riskLevel = 'block';
    }

    return {
      ...g, parallel, perAgentCtx, effectiveCtx: rawCtx, rawCtx,
      modelSizeB, kvGb, score: kvGb, warnings, riskLevel,
    };
  });

  const totalKvGb   = computed.reduce((sum, g) => sum + g.kvGb, 0);
  const liveUsedGb  = hostMemory?.ok && Number.isFinite(hostMemory.used_gb) ? hostMemory.used_gb : null;
  const baseRamGb   = liveUsedGb !== null ? liveUsedGb : RAM_MODEL_GB + RAM_OS_GB;
  const ramSource   = liveUsedGb !== null ? 'host' : 'estimate';
  const modeWeight      = getModeMemoryWeight(activeMode);
  const modeOverheadGb  = (modeWeight - 1) * 1.5;
  const totalRamGb  = baseRamGb + totalKvGb + mlxModelRamGb + modeOverheadGb;
  const band        = getRiskBand(totalRamGb);
  const liveRamHigh = liveUsedGb !== null && liveUsedGb > RAM_WARN_GB;
  const blockedGroups = [
    ...computed.filter(g => g.riskLevel === 'block'),
    ...(totalRamGb > RAM_BLOCK_GB ? computed : []),
  ].filter((g, i, arr) => arr.indexOf(g) === i);
  const warnGroups = computed.filter(g => g.riskLevel === 'warn');

  return {
    groups: computed.sort((a, b) => b.kvGb - a.kvGb),
    readyAgents,
    totalScore: totalRamGb,
    totalRamGb,
    totalKvGb,
    mlxModelRamGb,
    modeOverheadGb,
    activeMode,
    liveUsedGb,
    ramSource,
    liveRamHigh,
    band,
    blockedGroups,
    warnGroups,
  };
}
