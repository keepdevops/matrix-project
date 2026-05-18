import React, { useState } from 'react';
import AppHeader from '../components/AppHeader';
import PromptInput from '../components/PromptInput';
import AgentGrid from '../components/AgentGrid';
import HelpModal from '../components/HelpModal';
import FinalAnswerPanel from '../components/FinalAnswerPanel';
import RagSources from '../components/RagSources';
import RagAdmin from '../components/RagAdmin';
import CachePanel from '../components/CachePanel';
import ConversationThread from '../components/ConversationThread';
import MetricsStrip from '../components/MetricsStrip';
import './MinimalLayout.css';

export default function MinimalLayout({
  online, activeAgents, modes, activeMode, kvReadings, kvFetchFailed,
  responses, finalAnswer, loading, error, history, lastMeta,
  currentSession, backend, switchBackend,
  showConfig, showHistory, showConfigPanel, deployPending,
  showHelp, showConverter, showRagAdmin, showCachePanel,
  cacheStatus, useRag, pendingPrompt,
  flatPickAgent, excludedBreaker, stageOutputs,
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
  const [showAgents, setShowAgents] = useState(false);

  const agentCount = Object.keys(responses).length;

  return (
    <div className="ml-root">
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
      />

      <div className="ml-body">
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

        <div className="ml-chat">
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
        </div>

        <div className="ml-input-bar">
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
          <MetricsStrip envelope={{ meta: lastMeta }} />
        </div>

        {agentCount > 0 && (
          <div className="ml-agents-toggle">
            <button
              className="ml-agents-btn"
              onClick={() => setShowAgents(v => !v)}
            >
              {showAgents ? '▲ Hide' : '▼ Show'} agent responses ({agentCount})
            </button>
          </div>
        )}

        {showAgents && (
          <div className="ml-agents-panel">
            <AgentGrid
              activeAgents={activeAgents}
              responses={responses}
              loading={loading}
              timings={lastMeta?.timings || {}}
              onSaveCode={onSaveCode}
              flatPickMode={activeMode === 'flat'}
              pickedFlatAgent={flatPickAgent}
              onPickFlatAgent={onPickFlatAgent}
              onExpandProgrammer={(instruction) => onSubmit(instruction, 0.2, {
                followup: true,
                contextPolicy: {
                  include: ['original_prompt', 'final', 'programmer'],
                  target_agent: 'programmer',
                  max_context_chars: 24000,
                },
              })}
            />
          </div>
        )}
      </div>

      {showHelp && <HelpModal onClose={onOpenHelp} />}
      {showRagAdmin && <RagAdmin onClose={onOpenRagAdmin} />}
      {showCachePanel && <CachePanel onClose={onOpenCachePanel} />}
    </div>
  );
}
