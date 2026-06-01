import React from 'react';
import AppHeader from '../components/AppHeader';
import PromptInput from '../components/PromptInput';
import FinalAnswerPanel from '../components/FinalAnswerPanel';
import RagSources from '../components/RagSources';
import ConversationThread from '../components/ConversationThread';
import MetricsStrip from '../components/MetricsStrip';
import MinimalLayoutAgents from './MinimalLayoutAgents';
import './MinimalLayout.css';

export default function MinimalLayout({
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
  return (
    <div className="ml-root">
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
            history={history} sessionId={currentSession?.sessionId}
            responses={responses} finalAnswer={finalAnswer} loading={loading}
            pendingPrompt={pendingPrompt} onFollowUp={onFollowUp}
            onClear={onClearSession} onSwitchSession={onSwitchSession}
          />
          <FinalAnswerPanel text={finalAnswer} />
          <RagSources rag={lastMeta?.rag} />
        </div>

        <div className="ml-input-bar">
          <PromptInput
            onSubmit={onSubmit} loading={loading} disabled={!online}
            externalPrompt={selectedPrompt} externalTemperature={selectedTemperature}
            onPromptConsumed={onPromptConsumed} canContinue={Boolean(currentSession?.sessionId)}
            onQualityPass={onQualityPass} useRag={useRag} onUseRagChange={onUseRagChange}
            activeAgents={activeAgents} backend={backend} onBackendChange={switchBackend}
          />
          <MetricsStrip envelope={{ meta: lastMeta }} />
        </div>

        <MinimalLayoutAgents
          activeAgents={activeAgents} responses={responses} loading={loading}
          lastMeta={lastMeta} activeMode={activeMode} flatPickAgent={flatPickAgent}
          onPickFlatAgent={onPickFlatAgent} onSaveCode={onSaveCode} onSubmit={onSubmit}
          showHelp={showHelp} showRagAdmin={showRagAdmin} showCachePanel={showCachePanel}
          onOpenHelp={onOpenHelp} onOpenRagAdmin={onOpenRagAdmin} onOpenCachePanel={onOpenCachePanel}
        />
      </div>
    </div>
  );
}
