import React, { useMemo } from 'react';
import AppHeader from '../components/AppHeader';
import SwarmConfig from '../components/SwarmConfig';
import ModelConverter from '../components/ModelConverter';
import HelpModal from '../components/HelpModal';
import RagAdmin from '../components/RagAdmin';
import CachePanel from '../components/CachePanel';
import DashboardStatsBar from './DashboardStatsBar';
import DashboardMainGrid from './DashboardMainGrid';
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

      <DashboardStatsBar
        online={online} activeMode={activeMode} activeAgents={activeAgents}
        responses={responses} lastMeta={lastMeta} kvReadings={kvReadings}
        kvFetchFailed={kvFetchFailed}
      />

      {excludedBreaker.length > 0 && (
        <div className="dispatch-hint-banner dispatch-hint-banner--breaker" role="status">
          Skipped (circuit breaker open): <strong>{excludedBreaker.join(', ')}</strong>
        </div>
      )}
      {error && (
        <div className="error-banner">
          {error.includes('Coordinator offline')
            ? 'Swarm not running — open CONFIGURE and click LAUNCH SWARM.'
            : `ERROR: ${error}`}
        </div>
      )}

      {showConverter && (
        <div className="dl-panel-overlay">
          <ModelConverter standalone />
        </div>
      )}
      {!showConverter && showConfigPanel && <SwarmConfig onDeployed={onDeployed} />}

      {showHistory && history.length > 0 && (
        <div className="history-dropdown">
          {recentHistory.map((entry, i) => (
            <div key={entry._run_id || entry.timestamp || i} className="history-item" onClick={() => onHistorySelect(entry)}>
              <span className="history-prompt">
                {entry.prompt?.substring(0, 50)}{entry.prompt?.length > 50 ? '…' : ''}
              </span>
              <span className="history-time">
                {entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : ''}
              </span>
            </div>
          ))}
        </div>
      )}

      {!showConfigPanel && (
        <DashboardMainGrid
          online={online} activeAgents={activeAgents} activeMode={activeMode}
          responses={responses} finalAnswer={finalAnswer} loading={loading}
          history={history} lastMeta={lastMeta} currentSession={currentSession}
          backend={backend} switchBackend={switchBackend} useRag={useRag}
          pendingPrompt={pendingPrompt} flatPickAgent={flatPickAgent}
          stageOutputs={stageOutputs} selectedPrompt={selectedPrompt}
          selectedTemperature={selectedTemperature} onSubmit={onSubmit}
          onQualityPass={onQualityPass} onPromptConsumed={onPromptConsumed}
          onFollowUp={onFollowUp} onClearSession={onClearSession}
          onSwitchSession={onSwitchSession} onSaveCode={onSaveCode}
          onPickFlatAgent={onPickFlatAgent} onSendBestContinue={onSendBestContinue}
          onUseRagChange={onUseRagChange}
        />
      )}

      {showHelp      && <HelpModal  onClose={onOpenHelp} />}
      {showRagAdmin  && <RagAdmin   onClose={onOpenRagAdmin} />}
      {showCachePanel && <CachePanel onClose={onOpenCachePanel} />}
    </div>
  );
}

export default React.memo(DashboardLayout);
