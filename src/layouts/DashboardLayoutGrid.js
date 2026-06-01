import React from 'react';
import PromptInput from '../components/PromptInput';
import AgentGrid from '../components/AgentGrid';
import MetricsStrip from '../components/MetricsStrip';
import FinalAnswerPanel from '../components/FinalAnswerPanel';
import RagSources from '../components/RagSources';
import PipelineStageOutputs from '../components/PipelineStageOutputs';
import CompareVariantsPanel from '../components/CompareVariantsPanel';
import ConversationThread from '../components/ConversationThread';

export default function DashboardLayoutGrid({
  online, activeAgents, activeMode, responses, finalAnswer, loading, error,
  history, lastMeta, currentSession, backend, switchBackend,
  pendingPrompt, flatPickAgent, excludedBreaker, stageOutputs,
  useRag, selectedPrompt, selectedTemperature,
  onSubmit, onQualityPass, onPromptConsumed,
  onFollowUp, onClearSession, onSwitchSession,
  onSaveCode, onPickFlatAgent, onSendBestContinue, onUseRagChange,
}) {
  return (
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
  );
}
