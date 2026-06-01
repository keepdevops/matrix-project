import React from 'react';
import Button from './Button';
import RagControlsPanel from './RagControlsPanel';
import ModeParamControls from './ModeParamControls';
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
    ragHealth,
    prompt,
    setPrompt,
    temperature,
    setTemperature,
    ragTopK,
    setRagTopK,
    ragMinScore,
    setRagMinScore,
    selectedRagAgents,
    setSelectedRagAgents,
    textareaRef,
    modeParamFields,
    handleSubmit,
    handleKeyDown,
  } = usePromptInput({
    onSubmit,
    loading,
    disabled,
    externalPrompt,
    externalTemperature,
    onPromptConsumed,
    activeAgents,
    activeMode,
    useRag,
  });

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
            type="range"
            id="temperature"
            min="0.05"
            max="1.0"
            step="0.05"
            value={temperature}
            onChange={(e) => setTemperature(parseFloat(e.target.value))}
            disabled={loading || disabled}
            className="temperature-slider"
          />
        </div>
        <ModeParamControls
          activeMode={activeMode}
          activeAgents={activeAgents}
          loading={loading}
          disabled={disabled}
          {...modeParamFields}
        />
        <RagControlsPanel
          useRag={useRag}
          onUseRagChange={onUseRagChange}
          ragHealth={ragHealth}
          ragTopK={ragTopK}
          setRagTopK={setRagTopK}
          ragMinScore={ragMinScore}
          setRagMinScore={setRagMinScore}
          selectedRagAgents={selectedRagAgents}
          setSelectedRagAgents={setSelectedRagAgents}
          activeAgents={activeAgents}
          loading={loading}
          disabled={disabled}
        />
        <div
          className="backend-toggle"
          title="llama — parallel llama-server fleet  |  mlx — serialized MLX specialist"
        >
          <Button
            type="button"
            variant={backend === 'llama' ? 'outline-accent' : 'ghost'}
            size="xs"
            onClick={() => onBackendChange?.('llama')}
            disabled={loading || disabled}
            style={{ borderRadius: 'var(--btn-radius) 0 0 var(--btn-radius)', fontWeight: backend === 'llama' ? 600 : 400 }}
          >llama</Button>
          <Button
            type="button"
            variant={backend === 'mlx' ? 'outline-accent' : 'ghost'}
            size="xs"
            onClick={() => onBackendChange?.('mlx')}
            disabled={loading || disabled}
            style={{ borderRadius: '0 var(--btn-radius) var(--btn-radius) 0', borderLeft: 'none', fontWeight: backend === 'mlx' ? 600 : 400 }}
          >mlx</Button>
        </div>
        <Button
          variant="primary"
          size="md"
          type="submit"
          disabled={loading || disabled || !prompt.trim()}
        >
          {loading ? submitLoadingLabel : submitLabel}
        </Button>
        <Button
          variant="outline-accent"
          size="md"
          type="button"
          disabled={loading || disabled || !canContinue}
          onClick={() => onQualityPass?.(temperature)}
          title={canContinue ? 'Review and correct the previous output in this session' : `Run a ${submitLabel.toLowerCase()} first to start a session`}
        >
          {qualityPassLabel}
        </Button>
      </div>
    </form>
  );
}

export default React.memo(PromptInput);
