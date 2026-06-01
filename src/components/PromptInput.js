import React from 'react';
import RagControlsPanel from './RagControlsPanel';
import ModeParamControls from './ModeParamControls';
import PromptInputActions from './PromptInputActions';
import { usePromptInput } from './usePromptInput';

function PromptInput({
  onSubmit,
  loading = false,
  disabled = false,
  externalPrompt,
  externalTemperature,
  onPromptConsumed,
  canContinue = false,
  onQualityPass,
  useRag = false,
  onUseRagChange,
  activeAgents = [],
  backend = 'llama',
  onBackendChange,
  activeMode,
  submitLabel = 'BROADCAST',
  submitLoadingLabel = 'BROADCASTING...',
  qualityPassLabel = 'QUALITY PASS',
}) {
  const {
    ragHealth, prompt, setPrompt, temperature, setTemperature,
    ragTopK, setRagTopK, ragMinScore, setRagMinScore,
    selectedRagAgents, setSelectedRagAgents,
    textareaRef, modeParamFields, handleSubmit, handleKeyDown,
  } = usePromptInput({ onSubmit, loading, disabled, externalPrompt, externalTemperature, onPromptConsumed, activeAgents, activeMode, useRag });

  return (
    <form className="prompt-input" onSubmit={handleSubmit}>
      <div className="prompt-input-row">
        <textarea
          ref={textareaRef}
          className="prompt-textarea"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enter your prompt... (e.g., 'write fibonacci in python')"
          disabled={loading || disabled}
          rows={3}
        />
      </div>
      <div className="prompt-controls">
        <div className="temperature-control">
          <label htmlFor="temperature">
            Temperature: <span className="temp-value">{temperature.toFixed(2)}</span>
          </label>
          <input
            type="range" id="temperature" min="0.05" max="1.0" step="0.05"
            value={temperature} onChange={(e) => setTemperature(parseFloat(e.target.value))}
            disabled={loading || disabled} className="temperature-slider"
          />
        </div>
        <ModeParamControls
          activeMode={activeMode} activeAgents={activeAgents}
          loading={loading} disabled={disabled} {...modeParamFields}
        />
        <RagControlsPanel
          useRag={useRag} onUseRagChange={onUseRagChange} ragHealth={ragHealth}
          ragTopK={ragTopK} setRagTopK={setRagTopK}
          ragMinScore={ragMinScore} setRagMinScore={setRagMinScore}
          selectedRagAgents={selectedRagAgents} setSelectedRagAgents={setSelectedRagAgents}
          activeAgents={activeAgents} loading={loading} disabled={disabled}
        />
        <PromptInputActions
          backend={backend} onBackendChange={onBackendChange}
          loading={loading} disabled={disabled} prompt={prompt}
          canContinue={canContinue} onQualityPass={onQualityPass} temperature={temperature}
          submitLabel={submitLabel} submitLoadingLabel={submitLoadingLabel} qualityPassLabel={qualityPassLabel}
        />
      </div>
    </form>
  );
}

export default React.memo(PromptInput);
