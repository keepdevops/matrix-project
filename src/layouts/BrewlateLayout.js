import React, { useMemo, useCallback } from 'react';
import './brewlate.css';
import './brewlate-themes.css';
// Orchestrate: brew-brewcast-phase, _phase, depth, round — impl in BrewBroadcastTab.js
// RAG: lastMeta?.rag passed to RagSources — impl in BrewRagTab.js, BrewSessionTab.js
import { useDeploy } from '../components/SwarmConfig.deploy';
import { useBrewlateLayout } from './useBrewlateLayout';
import BrewHeader from './BrewHeader';
import { useBrewConfig } from './useBrewConfig';
import BrewConfigUnavailable from './BrewConfigUnavailable';
import BrewHistoryDropdown from './BrewHistoryDropdown';
import BrewlateLayoutBody from './BrewlateLayoutBody';
import BrewOverlays from './BrewOverlays';

export default function BrewlateLayout({
  online, activeAgents, modes, activeMode,
  kvReadings, kvFetchFailed, hostMemory,
  responses, agentErrors, finalAnswer, loading, error, history, lastMeta,
  currentSession, backend, switchBackend,
  showHistory, showHelp, showConverter, showRagAdmin, showCachePanel,
  cacheStatus, useRag, flatPickAgent, excludedBreaker, stageOutputs, budgetExhausted,
  qualityPassTarget, onQualityPassTargetChange,
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

  const { status, statusMsg, logTail, agentStatuses, deploy, reset } = useDeploy({ onDeployed: handleDeployedInternal });

  const brewConfig = useBrewConfig({ online, activeAgents, hostMemory, activeMode });
  const { roles, setRoles, models, roleModels, editingAgent, setEditingAgent, loadError, setLoadRetries, invalidateModelsCache } = brewConfig;
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

      <BrewlateLayoutBody
        brewConfig={brewConfig} status={status} statusMsg={statusMsg} logTail={logTail}
        agentStatuses={agentStatuses} deploy={deploy} reset={reset}
        showMonitor={showMonitor} setShowMonitor={setShowMonitor}
        showAgentsPopout={showAgentsPopout} setShowAgentsPopout={setShowAgentsPopout}
        setLeftPopout={setLeftPopout} online={online} activeAgents={activeAgents}
        kvReadings={kvReadings} kvFetchFailed={kvFetchFailed} excludedBreaker={excludedBreaker}
        cacheStatus={cacheStatus} onClearCache={onClearCache}
        responses={responses} agentErrors={agentErrors} lastMeta={lastMeta}
        deployed={deployed} rightTab={rightTab} onTabChange={setRightTab}
        rolesByName={rolesByName} history={history} currentSession={currentSession}
        finalAnswer={finalAnswer} loading={loading} error={error} pendingPrompt={pendingPrompt}
        stageOutputs={stageOutputs} selectedPrompt={selectedPrompt}
        selectedTemperature={selectedTemperature} useRag={useRag} backend={backend}
        activeMode={activeMode} flatPickAgent={flatPickAgent}
        onPickFlatAgent={onPickFlatAgent} onSaveCode={onSaveCode}
        onSendBestContinue={onSendBestContinue} onSubmit={onSubmit}
        onFollowUp={onFollowUp} onClearSession={onClearSession} onSwitchSession={onSwitchSession}
        onQualityPass={onQualityPass} onPromptConsumed={onPromptConsumed}
        onUseRagChange={onUseRagChange} switchBackend={switchBackend}
        onExpandProgrammer={onExpandProgrammer} onOpenRagAdmin={onOpenRagAdmin}
      />

      <BrewOverlays
        editingAgent={editingAgent} setEditingAgent={setEditingAgent} setRoles={setRoles}
        models={models} roleModels={roleModels}
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
