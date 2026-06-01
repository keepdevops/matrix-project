import React from 'react';
import BrewConfigPanel from './BrewConfigPanel';
import BrewRightPanel from './BrewRightPanel';

export default function BrewlateLayoutBody({
  brewConfig, status, statusMsg, agentStatuses, deploy, reset,
  showMonitor, setShowMonitor, showAgentsPopout, setShowAgentsPopout,
  setLeftPopout, online, activeAgents, kvReadings, kvFetchFailed,
  excludedBreaker, cacheStatus, onClearCache, responses, agentErrors,
  lastMeta, deployed, rightTab, onTabChange, rolesByName,
  history, currentSession, finalAnswer, loading, error, pendingPrompt,
  stageOutputs, selectedPrompt, selectedTemperature, useRag, backend,
  activeMode, flatPickAgent, onPickFlatAgent, onSaveCode, onSendBestContinue,
  onSubmit, onFollowUp, onClearSession, onSwitchSession, onQualityPass,
  onPromptConsumed, onUseRagChange, switchBackend, onExpandProgrammer, onOpenRagAdmin,
}) {
  return (
    <div className="brew-body">
      <BrewConfigPanel
        {...brewConfig}
        status={status} statusMsg={statusMsg} agentStatuses={agentStatuses}
        deploy={deploy} reset={reset}
        showMonitor={showMonitor} setShowMonitor={setShowMonitor}
        showAgentsPopout={showAgentsPopout} setShowAgentsPopout={setShowAgentsPopout}
        setLeftPopout={setLeftPopout}
        online={online} activeAgents={activeAgents} kvReadings={kvReadings}
        kvFetchFailed={kvFetchFailed} excludedBreaker={excludedBreaker}
        cacheStatus={cacheStatus} onClearCache={onClearCache}
        responses={responses} agentErrors={agentErrors} lastMeta={lastMeta}
      />

      <BrewRightPanel
        deployed={deployed} rightTab={rightTab} onTabChange={onTabChange}
        preview={{ rosterPct: brewConfig.rosterPct, serverLayout: brewConfig.serverLayout, configLines: brewConfig.configLines }}
        rolesByName={rolesByName}
        session={{
          history, currentSession, responses, finalAnswer, loading, error, pendingPrompt,
          lastMeta, stageOutputs, excludedBreaker, selectedPrompt, selectedTemperature,
          useRag, backend, online, activeAgents, activeMode, onSubmit, onFollowUp,
          onClearSession, onSwitchSession, onQualityPass, onPromptConsumed, onSaveCode,
          onUseRagChange, switchBackend, onExpandProgrammer,
        }}
        agents={{
          activeAgents, responses, agentErrors, loading, lastMeta, activeMode,
          flatPickAgent, onPickFlatAgent, onSaveCode, onSendBestContinue,
        }}
        broadcast={{
          activeAgents, responses, agentErrors, loading, lastMeta, stageOutputs,
          activeMode, flatPickAgent, onPickFlatAgent, onSaveCode,
        }}
        rag={{ useRag, onUseRagChange, activeAgents, loading, online, lastMeta, onOpenRagAdmin }}
      />
    </div>
  );
}
