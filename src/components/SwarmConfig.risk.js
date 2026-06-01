import { getModeMemoryWeight } from '../utils/modeManifest';
import { buildRiskGroups, scoreGroups, mlxModelRam } from './SwarmConfig.risk.helpers';

export const RAM_TOTAL_GB    = 36;  // fallback when host total unavailable
export const RAM_MODEL_GB    = 17;
export const RAM_OS_GB       = 4;
export const RAM_BLOCK_RATIO = 0.92; // >92% total → high risk
export const RAM_WARN_RATIO  = 0.78; // >78% total → medium risk

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
  const computed       = scoreGroups(groups, models);
  const mlxModelRamGb  = mlxModelRam(groups, models);
  const totalKvGb      = computed.reduce((sum, g) => sum + g.kvGb, 0);

  const liveUsedGb   = hostMemory?.ok && Number.isFinite(hostMemory.used_gb)   ? hostMemory.used_gb   : null;
  const liveTotalGb  = hostMemory?.ok && Number.isFinite(hostMemory.total_gb)  ? hostMemory.total_gb  : null;
  const ramTotalGb   = liveTotalGb ?? RAM_TOTAL_GB;
  const baseRamGb    = liveUsedGb  ?? RAM_MODEL_GB + RAM_OS_GB;
  const ramSource    = liveUsedGb !== null ? 'host' : 'estimate';
  const modeWeight   = getModeMemoryWeight(activeMode);
  const modeOverheadGb = (modeWeight - 1) * 1.5;
  const totalRamGb   = baseRamGb + totalKvGb + mlxModelRamGb + modeOverheadGb;
  const band         = getRiskBand(totalRamGb, ramTotalGb);
  const warnGb       = ramTotalGb * RAM_WARN_RATIO;
  const liveRamHigh  = liveUsedGb !== null && liveUsedGb > warnGb;

  const blockGb = ramTotalGb * RAM_BLOCK_RATIO;
  const blockedGroups = [
    ...computed.filter(g => g.riskLevel === 'block'),
    ...(totalRamGb > blockGb ? computed : []),
  ].filter((g, i, arr) => arr.indexOf(g) === i);

  const warnGroups = computed.filter(g => g.riskLevel === 'warn');

  return {
    groups: computed.sort((a, b) => b.kvGb - a.kvGb),
    readyAgents, totalScore: totalRamGb, totalRamGb, ramTotalGb, totalKvGb,
    mlxModelRamGb, modeOverheadGb, activeMode,
    liveUsedGb, liveTotalGb, ramSource, liveRamHigh,
    band, blockedGroups, warnGroups,
  };
}

export { RiskCard } from './SwarmConfig.risk.card';
