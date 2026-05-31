import React, { useMemo } from 'react';
import AppHeader from '../components/AppHeader';
import PromptInput from '../components/PromptInput';
import AgentGrid from '../components/AgentGrid';
import MetricsStrip from '../components/MetricsStrip';
import SwarmConfig from '../components/SwarmConfig';
import ModelConverter from '../components/ModelConverter';
import HelpModal from '../components/HelpModal';
import FinalAnswerPanel from '../components/FinalAnswerPanel';
import RagSources from '../components/RagSources';
import RagAdmin from '../components/RagAdmin';
import CachePanel from '../components/CachePanel';
import PressureCluster from '../components/PressureCluster';
import PipelineStageOutputs from '../components/PipelineStageOutputs';
import CompareVariantsPanel from '../components/CompareVariantsPanel';
import ConversationThread from '../components/ConversationThread';
import './DashboardLayout.css';

function StatTile({ label, value, sub, accent }) {
  return (
    <div className={`dl-stat-tile${accent ? ' dl-stat-tile--accent' : ''}`}>
      <div className="dl-stat-value">{value}</div>
      <div className="dl-stat-label">{label}</div>
      {sub && <div className="dl-stat-sub">{sub}</div>}
    </div>
  );
}

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
        <StatTile
          label="Status"
          value={online ? 'ONLINE' : 'OFFLINE'}
          accent={online}
        />
        <StatTile label="Mode"    value={activeMode || '—'} />
        <StatTile label="Agents"  value={agentCount} sub={`${responseCount} responded`} />
        {avgMs !== null && <StatTile label="Avg latency" value={`${avgMs}ms`} />}
        {kvPct !== null && (
          <StatTile
            label="KV usage"
            value={`${kvPct}%`}
            accent={kvPct > 80}
          />
        )}
        {lastMeta?.wall_ms && (
          <StatTile label="Wall time" value={`${Math.round(lastMeta.wall_ms)}ms`} />
        )}
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

      {/* ── Main grid ── */}
      {!showConfigPanel && (
        <div className="dl-grid">
          {/* Left column: chat */}
          <div className="dl-col-chat">
            <div className="dl-card">
              <div className="dl-card-title">Prompt</div>
              <PromptInput
                onSubmit={onSubmit} loading={loading} disabled={!online}
                externalPrompt={selectedPrompt} externalTemperature={selectedTemperature}
                onPromptConsumed={onPromptConsumed}
                canContinue={Boolean(currentSession?.sessionId)}
                onQualityPass={onQualityPass} useRag={useRag} onUseRagChange={onUseRagChange}
                activeAgents={activeAgents} backend={backend} onBackendChange={switchBackend}
              />
            </div>

            <div className="dl-card dl-card--grow">
              <div className="dl-card-title">Conversation</div>
              <ConversationThread
                history={history} sessionId={currentSession?.sessionId}
                responses={responses} finalAnswer={finalAnswer} loading={loading}
                pendingPrompt={pendingPrompt} onFollowUp={onFollowUp}
                onClear={onClearSession} onSwitchSession={onSwitchSession}
              />
            </div>

            <div className="dl-card">
              <div className="dl-card-title">Final Answer</div>
              <FinalAnswerPanel text={finalAnswer} />
              <RagSources rag={lastMeta?.rag} />
            </div>
          </div>

          {/* Right column: agents + metrics */}
          <div className="dl-col-agents">
            <div className="dl-card">
              <div className="dl-card-title">Metrics</div>
              <MetricsStrip envelope={{ meta: lastMeta }} />
              <PipelineStageOutputs stageOutputs={stageOutputs} />
            </div>

            <div className="dl-card dl-card--grow">
              <div className="dl-card-title">Agent Responses</div>
              <AgentGrid
                activeAgents={activeAgents} responses={responses} loading={loading}
                timings={lastMeta?.timings || {}} onSaveCode={onSaveCode}
                flatPickMode={activeMode === 'flat'} pickedFlatAgent={flatPickAgent}
                onPickFlatAgent={onPickFlatAgent}
                onExpandProgrammer={(instruction) => onSubmit(instruction, 0.2, {
                  followup: true,
                  contextPolicy: {
                    include: ['original_prompt', 'final', 'programmer'],
                    target_agent: 'programmer', max_context_chars: 24000,
                  },
                })}
              />
              {activeMode === 'flat' && Object.keys(responses).length > 0 && (
                <CompareVariantsPanel
                  activeAgents={activeAgents} responses={responses} loading={loading}
                  flatPickAgent={flatPickAgent} onPickAgent={onPickFlatAgent}
                  onSendBest={() => onSendBestContinue(0.2)}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {showHelp      && <HelpModal  onClose={onOpenHelp} />}
      {showRagAdmin  && <RagAdmin   onClose={onOpenRagAdmin} />}
      {showCachePanel && <CachePanel onClose={onOpenCachePanel} />}
    </div>
  );
}

export default React.memo(DashboardLayout);
