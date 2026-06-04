import React from 'react';
import ConversationThread from '../components/ConversationThread';
import FinalAnswerPanel from '../components/FinalAnswerPanel';
import BrewCodeResultsPanel from './BrewCodeResultsPanel';
import RagSources from '../components/RagSources';
import MetricsStrip from '../components/MetricsStrip';
import PipelineStageOutputs from '../components/PipelineStageOutputs';
import PromptInput from '../components/PromptInput';
import { useTokenBudget } from '../hooks/useTokenBudget';

export default function BrewSessionTab({
  history, currentSession, responses, finalAnswer, loading, error, pendingPrompt,
  lastMeta, stageOutputs, excludedBreaker,
  selectedPrompt, selectedTemperature, useRag, backend, online, activeAgents, activeMode,
  onSubmit, onFollowUp, onClearSession, onSwitchSession, onQualityPass,
  onPromptConsumed, onSaveCode, onUseRagChange, switchBackend, onExpandProgrammer,
}) {
  const { overrun } = useTokenBudget({ sessionId: currentSession?.sessionId, online });
  return (
    <div className="brew-session-tab">
      <div className="brew-session-scroll">
        {excludedBreaker.length > 0 && (
          <div className="dispatch-hint-banner dispatch-hint-banner--breaker brew-breaker-banner" role="status">
            Skipped (circuit breaker open):{' '}
            <strong>{excludedBreaker.join(', ')}</strong>. Cooldown ~30s.
          </div>
        )}
        {error && (
          <div className="error-banner brew-error-banner">
            {error.includes('Coordinator offline')
              ? 'Swarm not running — open CONFIGURE and click Brew.'
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
        <BrewCodeResultsPanel
          responses={responses}
          activeAgents={activeAgents}
          loading={loading}
          onSaveCode={onSaveCode}
          onExpandProgrammer={onExpandProgrammer}
        />
        <RagSources rag={lastMeta?.rag} />
        {lastMeta && (
          <>
            <PipelineStageOutputs stageOutputs={stageOutputs} />
            <MetricsStrip envelope={{ meta: lastMeta }} />
          </>
        )}
      </div>
      <div className="brew-session-prompt">
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
          activeMode={activeMode}
          budgetExhausted={overrun}
          submitLabel="BREW"
          submitLoadingLabel="BREWING…"
          qualityPassLabel="REFINE"
        />
      </div>
    </div>
  );
}
