import React, { useState, useEffect, useRef } from 'react';

function PromptInput({
  onSubmit,
  loading = false,
  disabled = false,
  externalPrompt,
  externalTemperature,
  onPromptConsumed,
  canContinue = false,
  onQualityPass,
}) {
  const [prompt, setPrompt] = useState('');
  const [temperature, setTemperature] = useState(0.2);
  const [useRag, setUseRag] = useState(false);
  const onPromptConsumedRef = useRef(onPromptConsumed);
  useEffect(() => { onPromptConsumedRef.current = onPromptConsumed; });

  // Sync from external source (e.g. history selection)
  useEffect(() => {
    if (externalPrompt !== undefined && externalPrompt !== null) {
      setPrompt(externalPrompt);
      onPromptConsumedRef.current?.();
    }
  }, [externalPrompt]);

  useEffect(() => {
    if (externalTemperature !== undefined && externalTemperature !== null) {
      setTemperature(externalTemperature);
    }
  }, [externalTemperature]);

  const submitPrompt = (opts = {}) => {
    if (prompt.trim() && !loading && !disabled) {
      onSubmit(prompt.trim(), temperature, { useRag, ...opts });
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    submitPrompt();
  };

  const handleKeyDown = (e) => {
    // Submit on Ctrl/Cmd + Enter
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      handleSubmit(e);
    }
  };

  return (
    <form className="prompt-input" onSubmit={handleSubmit}>
      <div className="prompt-input-row">
        <textarea
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
        <label className="rag-toggle" title="Prepend retrieved pgvector chunks to the prompt (requires rag.enabled in coordinator config)">
          <input
            type="checkbox"
            checked={useRag}
            onChange={(e) => setUseRag(e.target.checked)}
            disabled={loading || disabled}
          />
          {' '}Use RAG context
        </label>
        <button
          type="submit"
          className="submit-button"
          disabled={loading || disabled || !prompt.trim()}
        >
          {loading ? 'BROADCASTING...' : 'BROADCAST'}
        </button>
        <button
          type="button"
          className="submit-button continue-button"
          disabled={loading || disabled || !prompt.trim() || !canContinue}
          onClick={() => submitPrompt({
            followup: true,
            contextPolicy: {
              include: ['original_prompt', 'final', 'programmer'],
              target_agent: 'programmer',
              max_context_chars: 24000,
            },
          })}
          title={canContinue ? 'Append this prompt to the current session' : 'Run a broadcast first to start a session'}
        >
          CONTINUE
        </button>
        <button
          type="button"
          className="submit-button continue-button"
          disabled={loading || disabled || !canContinue}
          onClick={() => onQualityPass?.(temperature)}
          title={canContinue ? 'Review and correct the previous output in this session' : 'Run a broadcast first to start a session'}
        >
          QUALITY PASS
        </button>
      </div>
    </form>
  );
}

export default PromptInput;
