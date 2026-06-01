import React from 'react';
import {
  RAM_TOTAL_GB,
  RAM_WARN_GB,
  RAM_BLOCK_GB,
} from './SwarmConfig.riskCompute';

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
      {e.liveUsedGb != null && (
        <div className="swarm-risk-hint">
          Live host RAM: <strong>{e.liveUsedGb.toFixed(1)} GB</strong> used&nbsp;
          {e.liveRamHigh && <span style={{ color: 'var(--risk-high-color, #f87)' }}>⚠ already above warn threshold</span>}
        </div>
      )}
      {e.modeOverheadGb > 0 && (
        <div className="swarm-risk-hint">
          +{e.modeOverheadGb.toFixed(1)}GB estimated for <strong>{e.activeMode}</strong> orchestration overhead
        </div>
      )}
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
