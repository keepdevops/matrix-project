import React from 'react';
import BrewMonitorPopout from './BrewMonitorPopout';
import BrewResourcePopout from './BrewResourcePopout';
import BrewConfigAgentsSection from './BrewConfigAgentsSection';
import BrewConfigEngineProfile from './BrewConfigEngineProfile';
import { DeployProgress } from '../components/DeployProgress';

export default function BrewConfigPanel({
  roles, setRoles, models, selected, roleModels, engine, activeProfile, engineModels,
  editingAgent, setEditingAgent, loadError, loadRetries, setLoadRetries, invalidateModelsCache,
  riskEstimate, serverLayout, canDeploy, agentCount, rosterPct, configLines,
  handleEngineChange, toggleRole, setModel, selectAllRoles, clearAllRoles, applyProfile,
  status, statusMsg, logTail, agentStatuses, deploy, reset,
  showMonitor, setShowMonitor, showAgentsPopout, setShowAgentsPopout, setLeftPopout,
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
        open={showMonitor} onClose={() => setShowMonitor(false)}
        online={online} kvReadings={kvReadings} kvFetchFailed={kvFetchFailed}
        activeAgents={activeAgents} engine={engine} excludedBreaker={excludedBreaker}
        cacheStatus={cacheStatus} onClearCache={onClearCache}
      />

      <div className="brew-panel-scroll">
        <BrewConfigEngineProfile
          models={models} engine={engine} handleEngineChange={handleEngineChange}
          activeProfile={activeProfile} applyProfile={applyProfile} reset={reset}
        />

        <BrewConfigAgentsSection
          roles={roles} setRoles={setRoles} models={models} selected={selected}
          roleModels={roleModels} engineModels={engineModels} engine={engine}
          showAgentsPopout={showAgentsPopout} setShowAgentsPopout={setShowAgentsPopout}
          selectAllRoles={selectAllRoles} clearAllRoles={clearAllRoles}
          toggleRole={toggleRole} setModel={setModel} setEditingAgent={setEditingAgent}
          agentStatuses={agentStatuses} responses={responses} agentErrors={agentErrors}
          lastMeta={lastMeta} setLeftPopout={setLeftPopout}
        />

        {(canDeploy || online) && (
          <BrewResourcePopout riskEstimate={riskEstimate} roles={roles} selected={selected} />
        )}

        <div className="brew-left-footer">
          <DeployProgress status={status} statusMsg={statusMsg} logTail={logTail} />
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
