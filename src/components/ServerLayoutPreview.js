import React from 'react';
import Button from './Button';
import VllmPanel from './VllmPanel';
import ModeRosterPanel from './ModeRosterPanel';
import PresetsPanel from './PresetsPanel';
import { DeployProgress } from './DeployProgress';
import { RiskCard } from './SwarmConfig.risk';
import { getEngineLabel } from './SwarmConfig.helpers';

export default function ServerLayoutPreview({
  layout, engine, riskEstimate, isMixedBackends, activeBackends,
  selected, status, statusMsg, logTail, onDeploy, canDeploy,
}) {
  return (
    <div className="swarm-config-section">
      <div className="swarm-config-title">
        SERVER LAYOUT — {getEngineLabel(engine)} · {layout.length} server{layout.length !== 1 ? 's' : ''}, {selected.size} agent{selected.size !== 1 ? 's' : ''}
      </div>

      <RiskCard
        riskEstimate={riskEstimate}
        engine={engine}
        isMixedBackends={isMixedBackends}
        activeBackends={activeBackends}
      />

      <div className="swarm-layout">
        {layout.map(s => (
          <div key={s.port} className="swarm-layout-row">
            <span className="layout-port">:{s.port}</span>
            <span className={`layout-parallel layout-engine-${s.engine}`}>
              {s.engine === 'mlx' ? '[mlx]'
              : s.engine === 'vllm' ? '[vllm]'
              : `×${s.parallel}`}
            </span>
            <div className="layout-right">
              <div className="layout-agents">[{s.agents.join(', ')}]</div>
              <div className="layout-model">{s.model}</div>
            </div>
          </div>
        ))}
        {layout.length === 0 && (
          <div className="layout-empty">Select at least one agent</div>
        )}
      </div>

      {engine === 'vllm' && <VllmPanel />}

      <ModeRosterPanel />
      <PresetsPanel />

      <DeployProgress status={status} statusMsg={statusMsg} logTail={logTail} />

      <Button
        variant="outline-primary"
        size="md"
        className={`swarm-deploy-btn ${status}`}
        onClick={onDeploy}
        disabled={!canDeploy || status === 'deploying'}
      >
        {status === 'deploying' ? 'LAUNCHING...' : 'LAUNCH SWARM'}
      </Button>
    </div>
  );
}
