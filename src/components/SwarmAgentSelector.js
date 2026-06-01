import React from 'react';
import Button from './Button';
import SwarmAgentSelectorEngine from './SwarmAgentSelectorEngine';
import TokenBudgetPanel from './TokenBudgetPanel';

export default function SwarmAgentSelector({
  roles, models, selected, roleModels, engine, hasEngineModels, activeProfile, agentStatuses,
  onEngineChange, onToggleRole, onSetModel, onApplyProfile, onEditAgent, onRolesChange,
}) {
  return (
    <div className="swarm-config-section">
      <SwarmAgentSelectorEngine
        models={models} engine={engine} hasEngineModels={hasEngineModels}
        activeProfile={activeProfile} onEngineChange={onEngineChange} onApplyProfile={onApplyProfile}
      />
      <div className="swarm-roles-list">
        {roles.map(role => (
          <div key={role.name} className={`swarm-role-row ${selected.has(role.name) ? 'active' : ''}`}>
            <label className="swarm-role-check" title={role.description || role.name}>
              <input type="checkbox" checked={selected.has(role.name)} onChange={() => onToggleRole(role.name)} />
              <span className="swarm-role-name">{role.name}</span>
              {agentStatuses?.get(role.name) && (
                <span className={`agent-launch-badge badge-${agentStatuses.get(role.name)}`}>
                  {agentStatuses.get(role.name)}
                </span>
              )}
            </label>
            <Button variant="ghost" size="xs" type="button"
              title={role.description ? `${role.description}\n\nClick to edit system prompt` : `Edit ${role.name}'s system prompt`}
              onClick={() => onEditAgent(role)}>
              ✏️
            </Button>
            {models.length > 0 && (
              <select className="swarm-model-select" value={roleModels[role.name] || ''}
                onChange={e => onSetModel(role.name, e.target.value)}>
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
