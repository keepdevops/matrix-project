import React, { useMemo } from 'react';
import AppHeader from '../components/AppHeader';
import DashboardLayoutGrid from './DashboardLayoutGrid';
import DashboardLayoutOverlays from './DashboardLayoutOverlays';
import './DashboardLayout.css';

function DashboardLayout({
  online, activeAgents, modes, activeMode, kvReadings, kvFetchFailed,
  responses, finalAnswer, loading, error, history, lastMeta,
  currentSession, backend, switchBackend,
  showConfig, showHistory, showConfigPanel, deployPending,
  showHelp, showConverter, showRagAdmin, showCachePanel,
  cacheStatus, useRag, pendingPrompt,
  flatPickAgent, excludedBreaker, stageOutputs, warningsByMode, memoryPressure,
  theme, layout, onSetTheme, onSetLayout,
  onModeChange, onClearCache,
  onToggleConfig, onToggleHistory,
  onOpenConverter, onOpenRagAdmin, onOpenCachePanel, onOpenHelp,
  onDeployed, onHistorySelect,
  onSubmit, onQualityPass, onPromptConsumed,
  onFollowUp, onClearSession, onSwitchSession,
  onSaveCode, onPickFlatAgent, onSendBestContinue,
  onUseRagChange, selectedPrompt, selectedTemperature,
}) {
  const agentCount    = activeAgents.length;
  const responseCount = Object.keys(responses).length;
  const avgMs = useMemo(() => {
    if (!lastMeta?.timings) return null;
    const vals = Object.values(lastMeta.timings).map(t => t.total_ms).filter(Boolean);
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  }, [lastMeta]);
  const kvPct = useMemo(
    () => kvReadings?.length
      ? Math.round(kvReadings.reduce((s, r) => s + (r.usage ?? 0), 0) / kvReadings.length * 100)
      : null,
    [kvReadings]
  );
  const recentHistory = useMemo(() => history.slice(-10).reverse(), [history]);

  return (
    <div className="dl-root">
      <AppHeader
        online={online} activeAgents={activeAgents} modes={modes} activeMode={activeMode}
        kvReadings={kvReadings} kvFetchFailed={kvFetchFailed} cacheStatus={cacheStatus}
        showConfigPanel={showConfigPanel} theme={theme} layout={layout}
        historyCount={history.length} onModeChange={onModeChange} onClearCache={onClearCache}
        onToggleConfig={onToggleConfig} onToggleHistory={onToggleHistory}
        onOpenConverter={onOpenConverter} onOpenRagAdmin={onOpenRagAdmin}
        onOpenCachePanel={onOpenCachePanel} onOpenHelp={onOpenHelp}
        onSetTheme={onSetTheme} onSetLayout={onSetLayout}
        warningsByMode={warningsByMode} memoryPressure={memoryPressure}
      />

      <DashboardLayoutOverlays
        online={online} activeMode={activeMode} agentCount={agentCount}
        responseCount={responseCount} avgMs={avgMs} kvPct={kvPct} lastMeta={lastMeta}
        kvReadings={kvReadings} kvFetchFailed={kvFetchFailed}
        excludedBreaker={excludedBreaker} error={error}
        showConverter={showConverter} showConfigPanel={showConfigPanel}
        showHistory={showHistory} showHelp={showHelp}
        showRagAdmin={showRagAdmin} showCachePanel={showCachePanel}
        recentHistory={recentHistory} onDeployed={onDeployed}
        onHistorySelect={onHistorySelect} onOpenHelp={onOpenHelp}
        onOpenRagAdmin={onOpenRagAdmin} onOpenCachePanel={onOpenCachePanel}
      />

      {/* ── Main grid ── */}
      {!showConfigPanel && (
        <DashboardLayoutGrid
          online={online} activeAgents={activeAgents} activeMode={activeMode}
          responses={responses} finalAnswer={finalAnswer} loading={loading}
          error={error} history={history} lastMeta={lastMeta}
          currentSession={currentSession} backend={backend} switchBackend={switchBackend}
          pendingPrompt={pendingPrompt} flatPickAgent={flatPickAgent}
          excludedBreaker={excludedBreaker} stageOutputs={stageOutputs}
          useRag={useRag} selectedPrompt={selectedPrompt} selectedTemperature={selectedTemperature}
          onSubmit={onSubmit} onQualityPass={onQualityPass} onPromptConsumed={onPromptConsumed}
          onFollowUp={onFollowUp} onClearSession={onClearSession} onSwitchSession={onSwitchSession}
          onSaveCode={onSaveCode} onPickFlatAgent={onPickFlatAgent}
          onSendBestContinue={onSendBestContinue} onUseRagChange={onUseRagChange}
        />
      )}
    </div>
  );
}

export default React.memo(DashboardLayout);
