import React, { useMemo, useCallback } from 'react';
import './brewlate.css';
import './brewlate-themes.css';
import { useDeploy } from '../components/SwarmConfig.deploy';
import { useBrewlateLayout } from './useBrewlateLayout';
import BrewHeader from './BrewHeader';
import { useBrewConfig } from './useBrewConfig';
import BrewConfigPanel from './BrewConfigPanel';
import BrewConfigUnavailable from './BrewConfigUnavailable';
import BrewHistoryDropdown from './BrewHistoryDropdown';
import BrewRightPanel from './BrewRightPanel';
import BrewOverlays from './BrewOverlays';

export default function BrewlateLayout({
  online, activeAgents, modes, activeMode,
  kvReadings, kvFetchFailed, hostMemory,
  responses, agentErrors, finalAnswer, loading, error, history, lastMeta,
  currentSession, backend, switchBackend,
  showHistory, showHelp, showConverter, showRagAdmin, showCachePanel,
  cacheStatus, useRag, flatPickAgent, excludedBreaker, stageOutputs,
  warningsByMode, memoryPressure, theme, layout: currentLayout,
  pendingPrompt, selectedPrompt, selectedTemperature,
  onModeChange, onClearCache, onToggleHistory,
  onOpenConverter, onOpenRagAdmin, onOpenCachePanel, onOpenHelp,
  onCloseHelp, onCloseRagAdmin, onCloseCachePanel,
  onSetTheme, onSetLayout, onDeployed,
  onHistorySelect, onSubmit, onQualityPass, onPromptConsumed,
  onFollowUp, onClearSession, onSwitchSession,
  onSaveCode, onPickFlatAgent, onSendBestContinue, onUseRagChange,
  onExpandProgrammer,
}) {
  const {
    deployed, setDeployed, rightTab, setRightTab,
    showMonitor, setShowMonitor, showAgentsPopout, setShowAgentsPopout,
    leftPopout, setLeftPopout,
  } = useBrewlateLayout({ online, activeAgents, loading, lastMeta });

  const handleDeployedInternal = useCallback(() => {
    setDeployed(true);
    onDeployed?.();
  }, [setDeployed, onDeployed]);

  const { status, statusMsg, agentStatuses, deploy, reset } = useDeploy({ onDeployed: handleDeployedInternal });

  const brewConfig = useBrewConfig({ online, activeAgents, hostMemory, activeMode });
  const { roles, setRoles, editingAgent, setEditingAgent, loadError, setLoadRetries, invalidateModelsCache } = brewConfig;

  const rolesByName = useMemo(() => Object.fromEntries(roles.map(r => [r.name, r])), [roles]);

  if (loadError) {
    return (
      <BrewConfigUnavailable
        onRetry={() => { invalidateModelsCache(); setLoadRetries(r => r + 1); }}
      />
    );
  }

  return (
    <div className="layout-brewlate">
      <BrewHeader
        online={online} activeAgents={activeAgents} modes={modes} activeMode={activeMode}
        warningsByMode={warningsByMode} kvReadings={kvReadings} kvFetchFailed={kvFetchFailed}
        memoryPressure={memoryPressure} cacheStatus={cacheStatus} historyCount={history.length}
        deployed={deployed} theme={theme} layout={currentLayout}
        onModeChange={onModeChange} onClearCache={onClearCache} onToggleHistory={onToggleHistory}
        onOpenConverter={onOpenConverter} onOpenRagAdmin={onOpenRagAdmin}
        onOpenCachePanel={onOpenCachePanel} onOpenHelp={onOpenHelp}
        onSetTheme={onSetTheme} onSetLayout={onSetLayout}
        onShowConfigure={() => setDeployed(false)}
      />

      {showHistory && history.length > 0 && (
        <BrewHistoryDropdown history={history} onHistorySelect={onHistorySelect} />
      )}

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
          deployed={deployed} rightTab={rightTab} onTabChange={setRightTab}
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

      <BrewOverlays
        editingAgent={editingAgent} setEditingAgent={setEditingAgent} setRoles={setRoles}
        showConverter={showConverter} onOpenConverter={onOpenConverter}
        showHelp={showHelp} onCloseHelp={onCloseHelp}
        activeAgents={activeAgents}
        showRagAdmin={showRagAdmin} onCloseRagAdmin={onCloseRagAdmin}
        showCachePanel={showCachePanel} onCloseCachePanel={onCloseCachePanel}
        leftPopout={leftPopout} setLeftPopout={setLeftPopout}
      />
    </div>
  );
}
