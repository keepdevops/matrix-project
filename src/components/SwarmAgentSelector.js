import React from 'react';
import Button from './Button';
import {
  ENGINES,
  PROFILE_SAFE,
  PROFILE_BALANCED,
  PROFILE_MAX,
  PROFILE_MIXED,
  isAppleSilicon,
  getEngineLabel,
} from './SwarmConfig.helpers';
import TokenBudgetPanel from './TokenBudgetPanel';

export default function SwarmAgentSelector({
  roles, models, selected, roleModels, engine, hasEngineModels, activeProfile, agentStatuses,
  onEngineChange, onToggleRole, onSetModel, onApplyProfile, onEditAgent, onRolesChange,
}) {
  return (
    <div className="swarm-config-section">
      <div className="swarm-engine-row">
        <span className="swarm-engine-label">ENGINE</span>
        <div className="swarm-engine-toggle">
          {ENGINES.map(e => {
            const isAppleSiliconDisabled = isAppleSilicon && e.id === 'vllm';
            const count = models.filter(m => m.backend === e.backend).length;
            const isDisabled = count === 0 || isAppleSiliconDisabled;
            return (
              <Button
                key={e.id}
                variant="ghost"
                size="sm"
                className={`swarm-engine-btn engine-${e.id}${engine === e.id ? ' active' : ''}${isDisabled ? ' disabled' : ''}`}
                onClick={() => !isDisabled && onEngineChange(e.id)}
                title={
                  isAppleSiliconDisabled ? `${e.label} requires NVIDIA GPU (not available on Apple Silicon)`
                  : count === 0 ? `No ${e.label} models found in /Users/Shared/llama/models/`
                  : `${count} model${count !== 1 ? 's' : ''} available`
                }
              >
                {e.label}
                <span className="engine-count">{count}</span>
              </Button>
            );
          })}
        </div>
        {hasEngineModels && (
          <span className="swarm-engine-in-use" title="Inference engine for this configuration">
            Using: <strong>{getEngineLabel(engine)}</strong>
          </span>
        )}
        {!hasEngineModels && (
          <span className="swarm-engine-warn">no models found</span>
        )}
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
            <Button
              key={id}
              variant="ghost"
              size="sm"
              className={`swarm-profile-btn ${activeProfile === id ? 'active' : ''}`}
              onClick={() => onApplyProfile(id)}
              type="button"
              title={title}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>
      <div className="swarm-profile-note">
        Recommended daily default: <strong>SAFE</strong> (applies to current engine).
      </div>
      <div className="swarm-roles-list">
        {roles.map(role => (
          <div key={role.name}
               className={`swarm-role-row ${selected.has(role.name) ? 'active' : ''}`}>
            <label className="swarm-role-check" title={role.description || role.name}>
              <input
                type="checkbox"
                checked={selected.has(role.name)}
                onChange={() => onToggleRole(role.name)}
              />
              <span className="swarm-role-name">{role.name}</span>
              {agentStatuses?.get(role.name) && (
                <span className={`agent-launch-badge badge-${agentStatuses.get(role.name)}`}>
                  {agentStatuses.get(role.name)}
                </span>
              )}
            </label>
            <Button
              variant="ghost"
              size="xs"
              type="button"
              title={role.description ? `${role.description}\n\nClick to edit system prompt` : `Edit ${role.name}'s system prompt`}
              onClick={() => onEditAgent(role)}
            >
              ✏️
            </Button>
            {models.length > 0 && (
              <select
                className="swarm-model-select"
                value={roleModels[role.name] || ''}
                onChange={e => onSetModel(role.name, e.target.value)}
              >
                <option value="" disabled>Select model…</option>
                {Array.from(new Set(models.map(m => m.backend))).map(backend => (
                  <optgroup key={backend} label={backend}>
                    {models.filter(m => m.backend === backend).map(m => (
                      <option key={m.path} value={m.path}>{m.name}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            )}
          </div>
        ))}
      </div>
      <TokenBudgetPanel roles={roles} onRolesChange={onRolesChange} selected={selected} />
    </div>
  );
}
