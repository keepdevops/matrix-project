import {
  RAM_MODEL_GB,
  RAM_OS_GB,
  RAM_WARN_GB,
  RAM_BLOCK_GB,
  RAM_TOTAL_GB,
  getRiskBand,
  riskBandId,
} from '../components/SwarmConfig.risk';
import { getModeMemoryWeight } from './modeManifest';

// Per deployed agent beyond the baseline pair (architect + programmer).
const RAM_PER_EXTRA_AGENT_GB = 0.75;
const BASELINE_AGENT_COUNT = 2;
const KV_USAGE_WARN = 0.85;

/** Heuristic unified-memory estimate from live roster + orchestration mode. */
export function estimateDeployedRamGb(activeAgents, activeMode) {
  const count = Array.isArray(activeAgents) ? activeAgents.length : 0;
  const extra = Math.max(0, count - BASELINE_AGENT_COUNT);
  const modeWeight = getModeMemoryWeight(activeMode);
  const modeOverhead = (modeWeight - 1) * 1.5;
  return RAM_MODEL_GB + RAM_OS_GB + extra * RAM_PER_EXTRA_AGENT_GB + modeOverhead;
}

/** KV slot pressure (llama-server) — distinct from system RAM. */
export function maxKvUsage(kvReadings) {
  const live = (kvReadings || []).filter(
    r => r?.ok && r.backend !== 'mlx' && Number.isFinite(r.usage),
  );
  if (!live.length) return null;
  return Math.max(...live.map(r => r.usage));
}

/** RAM GB for banding — prefers live host snapshot when available. */
export function resolveRamGb({ activeAgents, activeMode, hostMemory }) {
  if (hostMemory?.ok && Number.isFinite(hostMemory.used_gb))
    return { ramGb: hostMemory.used_gb, ramSource: 'host' };
  return {
    ramGb: estimateDeployedRamGb(activeAgents, activeMode),
    ramSource: 'estimate',
  };
}

export function assessMemoryPressure({ activeAgents = [], activeMode, kvReadings = [], hostMemory = null }) {
  const agentCount = activeAgents.length;
  const { ramGb, ramSource } = resolveRamGb({ activeAgents, activeMode, hostMemory });
  const band = getRiskBand(ramGb);
  const bandId = riskBandId(band);
  const kvMax = maxKvUsage(kvReadings);
  const modeWeight = getModeMemoryWeight(activeMode);
  const heavyMode = modeWeight >= 2;
  const ramLabel = ramSource === 'host' ? 'System RAM' : 'RAM estimate';

  const warnings = [];
  const actions = [];

  if (bandId === 'high') {
    warnings.push(
      `${ramLabel} ~${ramGb.toFixed(1)}GB exceeds ${RAM_BLOCK_GB}GB — risk of OOM on ${RAM_TOTAL_GB}GB machine`,
    );
    actions.push('Open CONFIGURE and switch to SAFE profile');
    actions.push('Reduce agent roster or context windows');
  } else if (bandId === 'medium') {
    warnings.push(
      `${ramLabel} ~${ramGb.toFixed(1)}GB — ${RAM_WARN_GB}GB warn threshold on ${RAM_TOTAL_GB}GB budget`,
    );
    actions.push('Consider SAFE profile or fewer agents');
  }

  if (heavyMode && bandId !== 'low') {
    warnings.push(`${activeMode} mode runs sequential stages — higher peak memory`);
    actions.push('Switch to flat mode for lower orchestration overhead');
  }

  if (agentCount >= 8 && (bandId !== 'low' || heavyMode)) {
    warnings.push(`${agentCount} agents deployed — trim roster under memory pressure`);
    actions.push('Use SAFE preset in CONFIGURE (4–6 lighter agents)');
  }

  if (kvMax != null && kvMax >= KV_USAGE_WARN) {
    warnings.push(
      `KV cache slots ${Math.round(kvMax * 100)}% full (llama-server) — distinct from system RAM`,
    );
    actions.push('Clear KV cache or reduce context');
  }

  return {
    estimatedRamGb: ramGb,
    ramSource,
    hostMemory,
    band,
    bandId,
    agentCount,
    modeWeight,
    kvMax,
    warnings,
    actions,
    shouldWarnOnSubmit: bandId !== 'low' || (kvMax != null && kvMax >= KV_USAGE_WARN),
    suggestFlatMode: heavyMode && bandId !== 'low',
    suggestSafeProfile: bandId !== 'low',
  };
}
