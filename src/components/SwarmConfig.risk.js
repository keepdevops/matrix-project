import { getModeMemoryWeight } from '../utils/modeManifest';
import { buildRiskGroups, scoreGroups, mlxModelRam, modelWeightRam } from './SwarmConfig.risk.helpers';

export const RAM_TOTAL_GB    = 36;  // fallback when host total unavailable
export const RAM_MODEL_GB    = 17;  // 26B Q4_K_M ~16.2 GB; 17 is conservative
export const RAM_OS_GB       = 9;   // measured: ~7.2 GB wired + ~2.5 GB coord/proxy/UI/chrome
export const RAM_BLOCK_RATIO = 0.92; // >92% total → high risk
export const RAM_WARN_RATIO  = 0.78; // >78% total → medium risk
// Derived fallback constants for callers that need absolute GB values
export const RAM_BLOCK_GB = RAM_TOTAL_GB * RAM_BLOCK_RATIO; // ~33 GB at 36 GB total
export const RAM_WARN_GB  = RAM_TOTAL_GB * RAM_WARN_RATIO;  // ~28 GB at 36 GB total

export function getRiskBand(totalRamGb, ramTotalGb = RAM_TOTAL_GB) {
  const blockGb = ramTotalGb * RAM_BLOCK_RATIO;
  const warnGb  = ramTotalGb * RAM_WARN_RATIO;
  if (totalRamGb > blockGb) return { id: 'high',   label: 'HIGH',   hint: `Projected OOM — reduce agents or context (budget: ${ramTotalGb.toFixed(0)} GB)` };
  if (totalRamGb > warnGb)  return { id: 'medium', label: 'MEDIUM', hint: `Elevated memory pressure — watch for slowdowns (budget: ${ramTotalGb.toFixed(0)} GB)` };
  return                           { id: 'low',    label: 'LOW',    hint: `Well within ${ramTotalGb.toFixed(0)} GB memory budget` };
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
  const computed         = scoreGroups(groups, models);
  const modelWeightRamGb = modelWeightRam(groups, models);
  const mlxModelRamGb    = mlxModelRam(groups, models); // kept for return value / UI breakdown
  const totalKvGb        = computed.reduce((sum, g) => sum + g.kvGb, 0);

  const liveUsedGb  = hostMemory?.ok && Number.isFinite(hostMemory.used_gb)  ? hostMemory.used_gb  : null;
  const liveTotalGb = hostMemory?.ok && Number.isFinite(hostMemory.total_gb) ? hostMemory.total_gb : null;
  const ramTotalGb  = liveTotalGb ?? RAM_TOTAL_GB;
  // Base = OS overhead only; model weights are estimated per-group below
  const ramSource      = 'estimate';
  const modeWeight     = getModeMemoryWeight(activeMode);
  const modeOverheadGb = (modeWeight - 1) * 1.5;
  const totalRamGb     = RAM_OS_GB + modelWeightRamGb + totalKvGb + modeOverheadGb;
  const band           = getRiskBand(totalRamGb, ramTotalGb);
  const warnGb         = ramTotalGb * RAM_WARN_RATIO;
  // liveRamHigh: host is currently under pressure regardless of our projection
  const liveRamHigh    = liveUsedGb !== null && liveUsedGb > warnGb;

  const blockGb = ramTotalGb * RAM_BLOCK_RATIO;
  const blockedGroups = [
    ...computed.filter(g => g.riskLevel === 'block'),
    ...(totalRamGb > blockGb ? computed : []),
  ].filter((g, i, arr) => arr.indexOf(g) === i);

  const warnGroups = computed.filter(g => g.riskLevel === 'warn');

  return {
    groups: computed.sort((a, b) => b.kvGb - a.kvGb),
    readyAgents, totalScore: totalRamGb, totalRamGb, ramTotalGb, totalKvGb,
    modelWeightRamGb, mlxModelRamGb, modeOverheadGb, activeMode,
    liveUsedGb, liveTotalGb, ramSource, liveRamHigh,
    band, blockedGroups, warnGroups,
  };
}

export { RiskCard } from './SwarmConfig.risk.card';
