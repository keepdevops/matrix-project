import React from 'react';
import PromptInput from '../components/PromptInput';
import AgentGrid from '../components/AgentGrid';
import FinalAnswerPanel from '../components/FinalAnswerPanel';
import RagSources from '../components/RagSources';
import PipelineStageOutputs from '../components/PipelineStageOutputs';
import CompareVariantsPanel from '../components/CompareVariantsPanel';
import ConversationThread from '../components/ConversationThread';

const EXPAND_PROGRAMMER_OPTS = {
  followup: true,
  contextPolicy: {
    include: ['original_prompt', 'final', 'programmer'],
    target_agent: 'programmer',
    max_context_chars: 24000,
  },
};

export default function SidebarLayoutMain({
  excludedBreaker, error, online, loading, activeMode, activeAgents, responses,
  finalAnswer, pendingPrompt, history, currentSession, stageOutputs, lastMeta,
  backend, switchBackend, flatPickAgent, useRag, selectedPrompt, selectedTemperature,
  onSubmit, onQualityPass, onPromptConsumed, onFollowUp, onClearSession,
  onSwitchSession, onSaveCode, onPickFlatAgent, onSendBestContinue, onUseRagChange,
}) {
  return (
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
        onSubmit={onSubmit} loading={loading} disabled={!online}
        externalPrompt={selectedPrompt} externalTemperature={selectedTemperature}
        onPromptConsumed={onPromptConsumed}
        canContinue={Boolean(currentSession?.sessionId)}
        onQualityPass={onQualityPass} useRag={useRag} onUseRagChange={onUseRagChange}
        activeAgents={activeAgents} backend={backend} onBackendChange={switchBackend}
      />

      <ConversationThread
        history={history} sessionId={currentSession?.sessionId}
        responses={responses} finalAnswer={finalAnswer} loading={loading}
        pendingPrompt={pendingPrompt} onFollowUp={onFollowUp}
        onClear={onClearSession} onSwitchSession={onSwitchSession}
      />

      <FinalAnswerPanel text={finalAnswer} />
      <RagSources rag={lastMeta?.rag} />
      <PipelineStageOutputs stageOutputs={stageOutputs} />

      <AgentGrid
        activeAgents={activeAgents} responses={responses} loading={loading}
        timings={lastMeta?.timings || {}} onSaveCode={onSaveCode}
        flatPickMode={activeMode === 'flat'} pickedFlatAgent={flatPickAgent}
        onPickFlatAgent={onPickFlatAgent}
        onExpandProgrammer={(instruction) => onSubmit(instruction, 0.2, EXPAND_PROGRAMMER_OPTS)}
      />

      {activeMode === 'flat' && Object.keys(responses).length > 0 && (
        <CompareVariantsPanel
          activeAgents={activeAgents} responses={responses} loading={loading}
          flatPickAgent={flatPickAgent} onPickAgent={onPickFlatAgent}
          onSendBest={() => onSendBestContinue(0.2)}
        />
      )}
    </main>
  );
}
