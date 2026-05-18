import React from 'react';
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

export default function DefaultLayout({
  // coordinator state
  online, activeAgents, modes, activeMode, kvReadings, kvFetchFailed,
  // swarm state
  responses, finalAnswer, loading, error, history, lastMeta,
  currentSession, backend, switchBackend,
  // ui state
  showConfig, showHistory, showConfigPanel, deployPending,
  showHelp, showConverter, showRagAdmin, showCachePanel,
  cacheStatus, useRag, pendingPrompt,
  flatPickAgent, excludedBreaker, stageOutputs,
  // theme + layout
  theme, layout, onSetTheme, onSetLayout,
  // handlers
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
    <div className="matrix-container">
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

      {showConverter && (
        <div style={{ padding: '1rem 1.5rem', maxWidth: 860, margin: '0 auto' }}>
          <ModelConverter standalone />
        </div>
      )}

      {!showConverter && showConfigPanel && <SwarmConfig onDeployed={onDeployed} />}

      {showHistory && history.length > 0 && (
        <div className="history-dropdown">
          {history.slice(-10).reverse().map((entry, index) => (
            <div key={index} className="history-item" onClick={() => onHistorySelect(entry)}>
              <span className="history-prompt">
                {entry.prompt?.substring(0, 50)}{entry.prompt?.length > 50 ? '...' : ''}
              </span>
              <span className="history-time">
                {entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : ''}
              </span>
            </div>
          ))}
        </div>
      )}

      {!showConfigPanel && (
        <>
          <PressureCluster online={online} readings={kvReadings} fetchFailed={kvFetchFailed} />
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
          {excludedBreaker.length > 0 && (
            <div className="dispatch-hint-banner dispatch-hint-banner--breaker" role="status">
              Skipped (circuit breaker open):{' '}
              <strong>{excludedBreaker.join(', ')}</strong>. Cooldown ~30s after failures — see PER-MODE ROSTER health or coordinator logs.
            </div>
          )}
          {error && (
            <div className="error-banner">
              {error.includes('Coordinator offline')
                ? 'Swarm not running — open CONFIGURE and click LAUNCH SWARM.'
                : `ERROR: ${error}`}
            </div>
          )}
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
          <MetricsStrip envelope={{ meta: lastMeta }} />
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
            onExpandProgrammer={(instruction) => onSubmit(instruction, 0.2, {
              followup: true,
              contextPolicy: {
                include: ['original_prompt', 'final', 'programmer'],
                target_agent: 'programmer',
                max_context_chars: 24000,
              },
            })}
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
        </>
      )}

      {showHelp && <HelpModal onClose={onOpenHelp} />}
      {showRagAdmin && <RagAdmin onClose={onOpenRagAdmin} />}
      {showCachePanel && <CachePanel onClose={onOpenCachePanel} />}
    </div>
  );
}
