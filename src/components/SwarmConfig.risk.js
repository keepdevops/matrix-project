import React from 'react';
import {
  shortName,
  parseModelSizeBillions,
} from './SwarmConfig.helpers';

// RAM budget for 36GB unified memory (Apple Silicon M3 Max).
// Models (Llama-8B + Codestral-22B Q4) consume ~17GB.
// OS + runtime overhead: ~4GB.  Usable for KV cache: ~15GB.
// Block threshold: total estimated RAM > 33GB (3GB safety margin).
const RAM_TOTAL_GB   = 36;
const RAM_MODEL_GB   = 17;   // both models loaded
const RAM_OS_GB      = 4;
const RAM_BLOCK_GB   = 33;   // hard block above this
const RAM_WARN_GB    = 28;   // warn above this

// KV cache GB per 1024 tokens per model size (llama.cpp Q4/Q8 approximation).
// Codestral-22B: 32 layers, GQA-8, head_dim=128 → ~0.125 GB / 1024 tokens
// Llama-8B: 32 layers, GQA-8, head_dim=128 → ~0.04 GB / 1024 tokens
function kvGbPer1kTokens(modelSizeB, engine) {
  if (engine === 'mlx')  return 0.08;
  if (engine === 'vllm') return 0.10;
  if (modelSizeB === null) return 0.06;
  if (modelSizeB >= 20)  return 0.13;
  if (modelSizeB >= 13)  return 0.08;
  if (modelSizeB >= 7)   return 0.04;
  return 0.02;
}

function getRiskBand(totalRamGb) {
  if (totalRamGb > RAM_BLOCK_GB) return { id: 'high',   label: 'HIGH',   hint: 'Projected OOM — reduce agents or context' };
  if (totalRamGb > RAM_WARN_GB)  return { id: 'medium', label: 'MEDIUM', hint: 'Elevated memory pressure — watch for slowdowns' };
  return                                { id: 'low',    label: 'LOW',    hint: 'Well within 36GB memory budget' };
}

// computeRiskEstimate — groups selected roles by (engine, model, server_group),
// estimates KV cache GB, and returns a band + per-group breakdown for rendering.
export function computeRiskEstimate(roles, selected, roleModels, models) {
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

  // Sum MLX model weights from size_bytes (Metal memory — not captured by RAM_MODEL_GB
  // which only accounts for the two loaded llama models).
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

    // Score is now the estimated KV GB for this group (used for sorting).
    return {
      ...g, parallel, perAgentCtx, effectiveCtx: rawCtx, rawCtx,
      modelSizeB, kvGb, score: kvGb, warnings, riskLevel,
    };
  });

  const totalKvGb   = computed.reduce((sum, g) => sum + g.kvGb, 0);
  const totalRamGb  = RAM_MODEL_GB + RAM_OS_GB + totalKvGb + mlxModelRamGb;
  const band        = getRiskBand(totalRamGb);

  // Block if any group explicitly blocked, or if total RAM would OOM.
  const blockedGroups = [
    ...computed.filter(g => g.riskLevel === 'block'),
    ...(totalRamGb > RAM_BLOCK_GB ? computed : []),
  ].filter((g, i, arr) => arr.indexOf(g) === i);

  const warnGroups = computed.filter(g => g.riskLevel === 'warn');

  return {
    groups: computed.sort((a, b) => b.kvGb - a.kvGb),
    readyAgents,
    totalScore: totalRamGb,   // kept for API compat; now represents estimated GB
    totalRamGb,
    totalKvGb,
    mlxModelRamGb,
    band,
    blockedGroups,
    warnGroups,
  };
}

// Visual card summarizing the risk estimate.
export function RiskCard({ riskEstimate, engine, isMixedBackends, activeBackends }) {
  const e = riskEstimate;
  return (
    <div className={`swarm-risk-card risk-${e.band.id}`}>
      <div className="swarm-risk-header">
        <span>MEMORY ESTIMATE</span>
        <span className={`swarm-risk-badge risk-${e.band.id}`}>{e.band.label}</span>
      </div>
      <div className="swarm-risk-score">
        ~<strong>{e.totalRamGb != null ? e.totalRamGb.toFixed(1) : '—'}</strong> GB
        &nbsp;({RAM_TOTAL_GB}GB budget — warn at {RAM_WARN_GB}GB, block at {RAM_BLOCK_GB}GB)
      </div>
      {e.mlxModelRamGb > 0 && (
        <div className="swarm-risk-hint">
          Includes ~{e.mlxModelRamGb.toFixed(1)}GB MLX model weights in Metal memory
        </div>
      )}
      {isMixedBackends && (
        <div className="swarm-risk-mixed">
          Mixed backend plan: {activeBackends.join(' + ')}
        </div>
      )}
      <div className="swarm-risk-hint">{e.band.hint}</div>
      {e.blockedGroups.length > 0 && (
        <div className="swarm-risk-block">
          Launch blocked: projected RAM exceeds {RAM_BLOCK_GB}GB limit for this machine.
        </div>
      )}
      {e.groups.length > 0 && (
        <div className="swarm-risk-groups">
          {e.groups.map(g => (
            <div key={g.key} className="swarm-risk-row">
              <div className="swarm-risk-model">
                <span>{g.modelLabel}</span>
                <span className="swarm-risk-engine">[{g.engine}]</span>
              </div>
              <div className="swarm-risk-math">
                ctx {g.perAgentCtx} × {g.parallel} = {g.rawCtx} tokens, KV ≈{g.kvGb.toFixed(2)}GB
              </div>
              {g.warnings.length > 0 && (
                <div className="swarm-risk-warn">{g.warnings.join(' — ')}</div>
              )}
            </div>
          ))}
        </div>
      )}
      {e.readyAgents === 0 && (
        <div className="swarm-risk-hint">Select agents and models to estimate memory usage.</div>
      )}
    </div>
  );
}
