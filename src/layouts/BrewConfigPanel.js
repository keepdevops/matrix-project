import React from 'react';
import { ENGINES, PROFILES } from '../components/SwarmConfig.helpers';
import BrewMonitorPopout from './BrewMonitorPopout';
import BrewResourcePopout from './BrewResourcePopout';
import BrewConfigAgentsSection from './BrewConfigAgentsSection';

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

        <BrewConfigAgentsSection
          roles={roles}
          setRoles={setRoles}
          models={models}
          selected={selected}
          roleModels={roleModels}
          engineModels={engineModels}
          engine={engine}
          showAgentsPopout={showAgentsPopout}
          setShowAgentsPopout={setShowAgentsPopout}
          selectAllRoles={selectAllRoles}
          clearAllRoles={clearAllRoles}
          toggleRole={toggleRole}
          setModel={setModel}
          setEditingAgent={setEditingAgent}
          agentStatuses={agentStatuses}
          responses={responses}
          agentErrors={agentErrors}
          lastMeta={lastMeta}
          setLeftPopout={setLeftPopout}
        />

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
