import React, { useMemo } from 'react';
import AppHeader from '../components/AppHeader';
import SwarmConfig from '../components/SwarmConfig';
import ModelConverter from '../components/ModelConverter';
import HelpModal from '../components/HelpModal';
import RagAdmin from '../components/RagAdmin';
import CachePanel from '../components/CachePanel';
import PressureCluster from '../components/PressureCluster';
import DashboardStatTile from './DashboardStatTile';
import DashboardLayoutGrid from './DashboardLayoutGrid';
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

      {/* ── Stats bar ── */}
      <div className="dl-stats-bar">
        <DashboardStatTile label="Status" value={online ? 'ONLINE' : 'OFFLINE'} accent={online} />
        <DashboardStatTile label="Mode"   value={activeMode || '—'} />
        <DashboardStatTile label="Agents" value={agentCount} sub={`${responseCount} responded`} />
        {avgMs !== null && <DashboardStatTile label="Avg latency" value={`${avgMs}ms`} />}
        {kvPct !== null && <DashboardStatTile label="KV usage" value={`${kvPct}%`} accent={kvPct > 80} />}
        {lastMeta?.wall_ms && <DashboardStatTile label="Wall time" value={`${Math.round(lastMeta.wall_ms)}ms`} />}
        <div className="dl-stats-pressure">
          <PressureCluster online={online} readings={kvReadings} fetchFailed={kvFetchFailed} />
        </div>
      </div>

      {/* ── Banners ── */}
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

      {/* ── Config / converter panels ── */}
      {showConverter && <div className="dl-panel-overlay"><ModelConverter standalone /></div>}
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

      {showHelp      && <HelpModal  onClose={onOpenHelp} />}
      {showRagAdmin  && <RagAdmin   onClose={onOpenRagAdmin} />}
      {showCachePanel && <CachePanel onClose={onOpenCachePanel} />}
    </div>
  );
}

export default React.memo(DashboardLayout);
