import React, { useState, useEffect } from 'react';

/**
 * User input component for submitting prompts to the swarm
 */
function PromptInput({ onSubmit, loading = false, disabled = false, externalPrompt, externalTemperature }) {
  const [prompt, setPrompt] = useState('');
  const [temperature, setTemperature] = useState(0.7);

  // Sync from external source (e.g. history selection)
  useEffect(() => {
    if (externalPrompt !== undefined && externalPrompt !== null) {
      setPrompt(externalPrompt);
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
            Temperature: <span className="temp-value">{temperature.toFixed(1)}</span>
          </label>
          <input
            type="range"
            id="temperature"
            min="0.1"
            max="1.0"
            step="0.1"
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
      </div>
    </form>
  );
}

export default PromptInput;
