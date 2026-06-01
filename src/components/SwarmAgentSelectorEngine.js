import React from 'react';
import Button from './Button';
import {
  ENGINES, PROFILE_SAFE, PROFILE_BALANCED, PROFILE_MAX, PROFILE_MIXED,
  isAppleSilicon, getEngineLabel,
} from './SwarmConfig.helpers';

export default function SwarmAgentSelectorEngine({
  models, engine, hasEngineModels, activeProfile, onEngineChange, onApplyProfile,
}) {
  return (
    <>
      <div className="swarm-engine-row">
        <span className="swarm-engine-label">ENGINE</span>
        <div className="swarm-engine-toggle">
          {ENGINES.map(e => {
            const isAppleSiliconDisabled = isAppleSilicon && e.id === 'vllm';
            const count = models.filter(m => m.backend === e.backend).length;
            const isDisabled = count === 0 || isAppleSiliconDisabled;
            return (
              <Button key={e.id} variant="ghost" size="sm"
                className={`swarm-engine-btn engine-${e.id}${engine === e.id ? ' active' : ''}${isDisabled ? ' disabled' : ''}`}
                onClick={() => !isDisabled && onEngineChange(e.id)}
                title={
                  isAppleSiliconDisabled ? `${e.label} requires NVIDIA GPU (not available on Apple Silicon)`
                  : count === 0 ? `No ${e.label} models found in /Users/Shared/llama/models/`
                  : `${count} model${count !== 1 ? 's' : ''} available`
                }
              >
                {e.label}<span className="engine-count">{count}</span>
              </Button>
            );
          })}
        </div>
        {hasEngineModels
          ? <span className="swarm-engine-in-use" title="Inference engine for this configuration">Using: <strong>{getEngineLabel(engine)}</strong></span>
          : <span className="swarm-engine-warn">no models found</span>
        }
      </div>

      <div className="swarm-config-title">SELECT AGENTS</div>
      <div className="swarm-profile-row">
        <span className="swarm-profile-label">PROFILE</span>
        <div className="swarm-profile-buttons">
          {[
            [PROFILE_SAFE,     'SAFE',     'Safe baseline: 4-6 lighter agents and smaller models'],
            [PROFILE_BALANCED, 'BALANCED', 'Balanced coding: adds architect+programmer with one medium/heavy cohort'],
            [PROFILE_MAX,      'MAX',      'Max spread: select all available roles with smallest available llama models'],
            [PROFILE_MIXED,    'MIXED',    'Mixed: llama for core coding roles, MLX for support roles when available'],
          ].map(([id, label, title]) => (
            <Button key={id} variant="ghost" size="sm"
              className={`swarm-profile-btn ${activeProfile === id ? 'active' : ''}`}
              onClick={() => onApplyProfile(id)} type="button" title={title}>
              {label}
            </Button>
          ))}
        </div>
      </div>
      <div className="swarm-profile-note">
        Recommended daily default: <strong>SAFE</strong> (applies to current engine).
      </div>
    </>
  );
}
