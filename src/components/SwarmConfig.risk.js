import { getModeMemoryWeight } from '../utils/modeManifest';
import { buildRiskGroups, scoreGroups, mlxModelRam } from './SwarmConfig.risk.helpers';

export const RAM_TOTAL_GB = 36;
export const RAM_MODEL_GB = 17;
export const RAM_OS_GB    = 4;
export const RAM_BLOCK_GB = 33;
export const RAM_WARN_GB  = 28;

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
  const { groups, readyAgents } = buildRiskGroups(roles, selected, roleModels, models);
  const computed       = scoreGroups(groups, models);
  const mlxModelRamGb  = mlxModelRam(groups, models);
  const totalKvGb      = computed.reduce((sum, g) => sum + g.kvGb, 0);

  const liveUsedGb  = hostMemory?.ok && Number.isFinite(hostMemory.used_gb) ? hostMemory.used_gb : null;
  const baseRamGb   = liveUsedGb !== null ? liveUsedGb : RAM_MODEL_GB + RAM_OS_GB;
  const ramSource   = liveUsedGb !== null ? 'host' : 'estimate';
  const modeWeight  = getModeMemoryWeight(activeMode);
  const modeOverheadGb = (modeWeight - 1) * 1.5;
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
    readyAgents, totalScore: totalRamGb, totalRamGb, totalKvGb,
    mlxModelRamGb, modeOverheadGb, activeMode,
    liveUsedGb, ramSource, liveRamHigh,
    band, blockedGroups, warnGroups,
  };
}

export { RiskCard } from './SwarmConfig.risk.card';
