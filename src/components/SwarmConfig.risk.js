import React from 'react';
import {
  shortName,
  getModelWeight,
  getRiskBand,
  parseModelSizeBillions,
  getEngineLabel,
} from './SwarmConfig.helpers';

// computeRiskEstimate — pure function, no React.
// Mirrors the original behavior in SwarmConfig.js: groups selected roles by
// (engine, model, server_group), scores each group's projected GPU pressure,
// and returns a band + per-group breakdown for rendering.
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
        key,
        engine: agentEngine,
        modelPath,
        modelLabel: shortName(modelPath),
        agents: [],
        maxContext: roleContext,
      };
    }
    groups[key].agents.push(role.name);
    groups[key].maxContext = Math.max(groups[key].maxContext, roleContext);
  }

  const computed = Object.values(groups).map(g => {
    const parallel = g.agents.length;
    const perAgentCtx = Math.min(g.maxContext, 8192);
    const rawCtx = perAgentCtx * parallel;
    const effectiveCtx = Math.min(rawCtx, 16384);
    const modelWeight = getModelWeight(g.modelPath, g.engine);
    const modelSizeB = parseModelSizeBillions(g.modelPath);
    const parallelWeight = 1 + (0.15 * Math.max(0, parallel - 1));
    const score = modelWeight * (effectiveCtx / 1024) * parallelWeight;
    const warnings = [];
    let riskLevel = 'ok';
    if (g.engine === 'llama' && effectiveCtx >= 12288) {
      warnings.push('high context load');
      riskLevel = 'warn';
    }
    if (rawCtx > 16384) {
      warnings.push('ctx capped to 16384');
      riskLevel = 'block';
    }
    if (g.engine === 'llama' && modelSizeB !== null && modelSizeB >= 8 && effectiveCtx >= 16384) {
      warnings.push('8B model at ctx cap');
      riskLevel = 'block';
    }
    if (g.engine === 'mlx') {
      if (modelSizeB !== null && modelSizeB >= 8 && parallel >= 3) {
        warnings.push('MLX 8B+ high parallel');
        riskLevel = 'block';
      } else if (parallel >= 4 || effectiveCtx >= 12288) {
        warnings.push('MLX high concurrency');
        riskLevel = riskLevel === 'block' ? 'block' : 'warn';
      }
    }
    if (g.engine === 'vllm') {
      if (modelSizeB !== null && modelSizeB >= 14 && parallel >= 2) {
        warnings.push('vLLM 14B+ high parallel');
        riskLevel = 'block';
      } else if ((modelSizeB !== null && modelSizeB >= 8 && effectiveCtx >= 8192) || parallel >= 3) {
        warnings.push('vLLM elevated memory load');
        riskLevel = riskLevel === 'block' ? 'block' : 'warn';
      }
    }
    return {
      ...g, parallel, perAgentCtx, effectiveCtx, rawCtx,
      modelSizeB, modelWeight, parallelWeight, score, warnings, riskLevel,
    };
  });

  const totalScore = computed.reduce((sum, g) => sum + g.score, 0);
  const blockedGroups = computed.filter(g => g.riskLevel === 'block');
  const warnGroups = computed.filter(g => g.riskLevel === 'warn');
  return {
    groups: computed.sort((a, b) => b.score - a.score),
    readyAgents,
    totalScore,
    band: getRiskBand(totalScore),
    blockedGroups,
    warnGroups,
  };
}

// Visual card summarizing the risk estimate. Pure presentational — receives
// the precomputed estimate plus active engine context for labeling.
export function RiskCard({ riskEstimate, engine, isMixedBackends, activeBackends }) {
  const e = riskEstimate;
  return (
    <div className={`swarm-risk-card risk-${e.band.id}`}>
      <div className="swarm-risk-header">
        <span>OOM RISK ESTIMATE</span>
        <span className={`swarm-risk-badge risk-${e.band.id}`}>{e.band.label}</span>
      </div>
      <div className="swarm-risk-score">
        Score: <strong>{e.totalScore.toFixed(1)}</strong> (yellow at 12, red at 18+)
      </div>
      {isMixedBackends && (
        <div className="swarm-risk-mixed">
          Mixed backend plan detected: {activeBackends.join(' + ')}
        </div>
      )}
      <div className="swarm-risk-hint">{e.band.hint}</div>
      {e.blockedGroups.length > 0 && (
        <div className="swarm-risk-block">
          Launch blocked: one or more groups exceed safe limits for {getEngineLabel(engine)}.
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
                ctx {g.perAgentCtx} x {g.parallel} -&gt; {g.effectiveCtx}, score {g.score.toFixed(1)}
              </div>
              {g.warnings.length > 0 && (
                <div className="swarm-risk-warn">{g.warnings.join(' - ')}</div>
              )}
            </div>
          ))}
        </div>
      )}
      {e.readyAgents === 0 && (
        <div className="swarm-risk-hint">Select agents and models to estimate memory pressure.</div>
      )}
    </div>
  );
}
