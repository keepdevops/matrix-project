import React, { useState } from 'react';
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
import './SidebarLayout.css';

const EXPAND_PROGRAMMER_OPTS = {
  followup: true,
  contextPolicy: {
    include: ['original_prompt', 'final', 'programmer'],
    target_agent: 'programmer',
    max_context_chars: 24000,
  },
};

export default function SidebarLayout({
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div className="sl-root">
      <AppHeader
        online={online}
        activeAgents={activeAgents}
        modes={modes}
        activeMode={activeMode}
        kvReadings={kvReadings}
        kvFetchFailed={kvFetchFailed}
        cacheStatus={cacheStatus}
        showConfigPanel={showConfigPanel}
        theme={theme}
        layout={layout}
        historyCount={history.length}
        onModeChange={onModeChange}
        onClearCache={onClearCache}
        onToggleConfig={onToggleConfig}
        onToggleHistory={onToggleHistory}
        onOpenConverter={onOpenConverter}
        onOpenRagAdmin={onOpenRagAdmin}
        onOpenCachePanel={onOpenCachePanel}
        onOpenHelp={onOpenHelp}
        onSetTheme={onSetTheme}
        onSetLayout={onSetLayout}
        warningsByMode={warningsByMode}
        memoryPressure={memoryPressure}
      />

      <div className={`sl-body${sidebarCollapsed ? ' sl-body--collapsed' : ''}`}>
        {/* ── Sidebar ── */}
        <aside className="sl-sidebar">
          <button
            className="sl-collapse-btn"
            onClick={() => setSidebarCollapsed(v => !v)}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {sidebarCollapsed ? '›' : '‹'}
          </button>

          {!sidebarCollapsed && (
            <>
              <div className="sl-sidebar-section">
                <PressureCluster online={online} readings={kvReadings} fetchFailed={kvFetchFailed} />
              </div>

              {showConverter && (
                <div className="sl-sidebar-section">
                  <ModelConverter standalone />
                </div>
              )}

              {!showConverter && showConfigPanel && (
                <div className="sl-sidebar-section sl-sidebar-section--config">
                  <SwarmConfig onDeployed={onDeployed} />
                </div>
              )}

              {showHistory && history.length > 0 && (
                <div className="sl-sidebar-section">
                  <div className="sl-sidebar-label">History</div>
                  {history.slice(-10).reverse().map((entry, i) => (
                    <div key={i} className="history-item" onClick={() => onHistorySelect(entry)}>
                      <span className="history-prompt">
                        {entry.prompt?.substring(0, 40)}{entry.prompt?.length > 40 ? '…' : ''}
                      </span>
                      <span className="history-time">
                        {entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : ''}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <div className="sl-sidebar-section">
                <MetricsStrip envelope={{ meta: lastMeta }} />
              </div>
            </>
          )}
        </aside>

        {/* ── Main ── */}
        <main className="sl-main">
          {excludedBreaker.length > 0 && (
            <div className="dispatch-hint-banner dispatch-hint-banner--breaker" role="status">
              Skipped (circuit breaker open):{' '}
              <strong>{excludedBreaker.join(', ')}</strong>. Cooldown ~30s after failures.
            </div>
          )}
          {error && (
            <div className="error-banner">
              {error.includes('Coordinator offline')
                ? 'Swarm not running — open CONFIGURE and click LAUNCH SWARM.'
                : `ERROR: ${error}`}
            </div>
          )}

          <PromptInput
            onSubmit={onSubmit}
            loading={loading}
            disabled={!online}
            externalPrompt={selectedPrompt}
            externalTemperature={selectedTemperature}
            onPromptConsumed={onPromptConsumed}
            canContinue={Boolean(currentSession?.sessionId)}
            onQualityPass={onQualityPass}
            useRag={useRag}
            onUseRagChange={onUseRagChange}
            activeAgents={activeAgents}
            backend={backend}
            onBackendChange={switchBackend}
          />

          <ConversationThread
            history={history}
            sessionId={currentSession?.sessionId}
            responses={responses}
            finalAnswer={finalAnswer}
            loading={loading}
            pendingPrompt={pendingPrompt}
            onFollowUp={onFollowUp}
            onClear={onClearSession}
            onSwitchSession={onSwitchSession}
          />

          <FinalAnswerPanel text={finalAnswer} />
          <RagSources rag={lastMeta?.rag} />
          <PipelineStageOutputs stageOutputs={stageOutputs} />

          <AgentGrid
            activeAgents={activeAgents}
            responses={responses}
            loading={loading}
            timings={lastMeta?.timings || {}}
            onSaveCode={onSaveCode}
            flatPickMode={activeMode === 'flat'}
            pickedFlatAgent={flatPickAgent}
            onPickFlatAgent={onPickFlatAgent}
            onExpandProgrammer={(instruction) => onSubmit(instruction, 0.2, EXPAND_PROGRAMMER_OPTS)}
          />

          {activeMode === 'flat' && Object.keys(responses).length > 0 && (
            <CompareVariantsPanel
              activeAgents={activeAgents}
              responses={responses}
              loading={loading}
              flatPickAgent={flatPickAgent}
              onPickAgent={onPickFlatAgent}
              onSendBest={() => onSendBestContinue(0.2)}
            />
          )}
        </main>
      </div>

      {showHelp && <HelpModal onClose={onOpenHelp} />}
      {showRagAdmin && <RagAdmin onClose={onOpenRagAdmin} />}
      {showCachePanel && <CachePanel onClose={onOpenCachePanel} />}
    </div>
  );
}
