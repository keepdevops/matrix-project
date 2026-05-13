import React, { useState, useEffect, useRef } from 'react';

function PromptInput({ onSubmit, loading = false, disabled = false, hasHistory = false, externalPrompt, externalTemperature, onPromptConsumed }) {
  const [prompt, setPrompt] = useState('');
  const [temperature, setTemperature] = useState(0.2);
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

  const handleSubmit = (e) => {
    e.preventDefault();
    if (prompt.trim() && !loading && !disabled) {
      onSubmit(prompt.trim(), temperature);
    }
  };

  const handleRefine = () => {
    if (prompt.trim() && !loading && !disabled && hasHistory) {
      onSubmit(prompt.trim(), temperature, { refine: true });
    }
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
        <button
          type="submit"
          className="submit-button"
          disabled={loading || disabled || !prompt.trim()}
        >
          {loading ? 'BROADCASTING...' : 'BROADCAST'}
        </button>
        <button
          type="button"
          className="refine-button"
          onClick={handleRefine}
          disabled={loading || disabled || !prompt.trim() || !hasHistory}
          title={hasHistory
            ? 'Resend with prior conversation as context'
            : 'Submit at least one prompt first to enable refine'}
        >
          REFINE
        </button>
      </div>
    </form>
  );
}

export default PromptInput;
