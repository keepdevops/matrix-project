import React from 'react';
import { ENGINES, PROFILE_CUSTOM, PROFILES } from '../components/SwarmConfig.helpers';
import BrewMonitorPopout from './BrewMonitorPopout';
import BrewAgentsPopout from './BrewAgentsPopout';
import BrewResourcePopout from './BrewResourcePopout';
import BrewAgentCard, { modelShortName } from './BrewAgentCard';
import { extractCodeBlock } from '../utils/codeExtractor';

export default function BrewConfigPanel({
  // config state
  roles, setRoles, models, selected, roleModels, engine, activeProfile, engineModels,
  editingAgent, setEditingAgent, loadError, loadRetries, setLoadRetries, invalidateModelsCache,
  riskEstimate, serverLayout, canDeploy, agentCount, rosterPct, configLines,
  handleEngineChange, toggleRole, setModel, selectAllRoles, clearAllRoles, applyProfile,
  // deploy state
  status, statusMsg, agentStatuses, deploy, reset,
  // popout state
  showMonitor, setShowMonitor, showAgentsPopout, setShowAgentsPopout, setLeftPopout,
  // external
  online, activeAgents, kvReadings, kvFetchFailed, excludedBreaker,
  cacheStatus, onClearCache, responses, agentErrors, lastMeta,
}) {
  return (
    <div className="brew-panel brew-panel--left">
      <div className="brew-panel-header">
        <span className="brew-panel-title">Configure</span>
        <div className="brew-panel-header-actions">
          {(canDeploy || online) && (
            <button
              type="button"
              className={`brew-monitor-trigger${showMonitor ? ' open' : ''}${online ? ' online' : ''}`}
              onClick={() => setShowMonitor(v => !v)}
              aria-expanded={showMonitor}
              title="KV cache and port pressure"
            >
              <span className={`brew-monitor-trigger-dot${online ? ' online' : ''}`} />
              MONITOR
            </button>
          )}
          <span className="brew-panel-badge">
            {activeProfile} • {agentCount} Agent{agentCount !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      <BrewMonitorPopout
        open={showMonitor}
        onClose={() => setShowMonitor(false)}
        online={online}
        kvReadings={kvReadings}
        kvFetchFailed={kvFetchFailed}
        activeAgents={activeAgents}
        engine={engine}
        excludedBreaker={excludedBreaker}
        cacheStatus={cacheStatus}
        onClearCache={onClearCache}
      />

      <div className="brew-panel-scroll">
        <div className="brew-section">
          <div className="brew-section-header">
            <span className="brew-section-title">Engines</span>
          </div>
          <div className="brew-section-body">
            <div className="brew-engine-pills">
              {ENGINES.map(e => {
                const count = models.filter(m => m.backend === e.backend).length;
                return (
                  <button
                    key={e.id}
                    type="button"
                    className={`brew-engine-pill${engine === e.id ? ' active' : ''}${count === 0 ? ' disabled' : ''}`}
                    onClick={() => count > 0 && handleEngineChange(e.id)}
                    title={`${count} model${count !== 1 ? 's' : ''} available`}
                  >
                    {e.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="brew-section">
          <div className="brew-section-header">
            <span className="brew-section-title">Profile</span>
          </div>
          <div className="brew-section-body">
            <div className="brew-profile-label">Preset</div>
            <div className="brew-profile-dropdowns">
              <select
                className="brew-profile-select"
                value={activeProfile}
                onChange={e => applyProfile(e.target.value, reset)}
              >
                {PROFILES.map(([id, label]) => (
                  <option key={id} value={id}>{label}</option>
                ))}
              </select>
            </div>
            <p className="brew-profile-hint">
              Presets fill the roster; use <strong>Custom</strong> and click agents to pick individually.
            </p>
          </div>
        </div>

        <div className="brew-section brew-section--agents" style={{ flex: '1 1 0', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div className="brew-section-header brew-section-header--agents">
            <span className="brew-section-title">Agents</span>
            <div className="brew-agents-header-actions">
              <button type="button" className="brew-agents-bulk-btn" onClick={selectAllRoles} title="Select every agent role">All</button>
              <button type="button" className="brew-agents-bulk-btn" onClick={clearAllRoles} title="Clear agent selection">None</button>
              <button
                type="button"
                className={`brew-agents-popout-trigger${showAgentsPopout ? ' open' : ''}`}
                onClick={() => setShowAgentsPopout(v => !v)}
                aria-expanded={showAgentsPopout}
                title="Per-agent context and max token budgets"
              >BUDGETS</button>
            </div>
          </div>

          <BrewAgentsPopout
            open={showAgentsPopout}
            onClose={() => setShowAgentsPopout(false)}
            roles={roles}
            selected={selected}
            onRolesChange={setRoles}
          />

          <div className="brew-section-body" style={{ flex: '1 1 0', overflowY: 'auto', padding: '0.75rem' }}>
            <div className="brew-agent-cards">
              {roles.map(role => {
                const isSelected   = selected.has(role.name);
                const modelPath    = roleModels[role.name] || '';
                const ctx          = role.context || 0;
                const launchStatus = agentStatuses?.get(role.name);
                const meta = launchStatus
                  ? launchStatus.toUpperCase()
                  : ctx > 0 ? `Context ${ctx.toLocaleString()}` : 'Context —';
                const response   = responses?.[role.name] ?? null;
                const agentError = agentErrors?.[role.name] ?? null;
                const timing     = lastMeta?.timings?.[role.name] ?? null;
                const hasResult  = !!(response || agentError);
                const onExpand   = hasResult ? () => {
                  const { code, language } = response
                    ? extractCodeBlock(response) : { code: null, language: null };
                  const resultMeta = timing
                    ? `${(timing.total_ms / 1000).toFixed(1)}s`
                    : agentError ? 'FAILED' : meta;
                  setLeftPopout({
                    name: role.name.toUpperCase(), model: modelShortName(modelPath),
                    meta: resultMeta, response, error: agentError,
                    code: code && code.trim().length >= 10 ? code : null, language,
                  });
                } : undefined;
                return (
                  <BrewAgentCard
                    key={role.name}
                    name={role.name.toUpperCase()}
                    modelPath={modelPath}
                    meta={meta}
                    selected={isSelected}
                    hasResult={hasResult}
                    onClick={() => toggleRole(role.name)}
                    onEdit={() => setEditingAgent(role)}
                    onExpand={onExpand}
                    showCheckbox
                    checked={isSelected}
                    showModelSelect={engineModels.length > 0}
                    models={engineModels.length > 0 ? engineModels : models}
                    onModelChange={path => setModel(role.name, path)}
                  />
                );
              })}
            </div>
          </div>
        </div>

        {(canDeploy || online) && (
          <BrewResourcePopout riskEstimate={riskEstimate} roles={roles} selected={selected} />
        )}

        <div className="brew-left-footer">
          {statusMsg && <div className="brew-deploy-status">{statusMsg}</div>}
          <button
            type="button"
            className="brew-launch-btn"
            onClick={() => deploy({ roles, selected, roleModels, models, engine, riskEstimate, layout: serverLayout })}
            disabled={!canDeploy || status === 'deploying'}
          >
            {status === 'deploying' ? 'Brewing…' : 'Brew'}
          </button>
        </div>
      </div>
    </div>
  );
}
