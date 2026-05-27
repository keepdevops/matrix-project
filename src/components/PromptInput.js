import React, { useState, useEffect, useRef } from 'react';
import useRagHealth from '../hooks/useRagHealth';
import Button from './Button';
import RagControlsPanel from './RagControlsPanel';

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
}) {
  const ragHealth = useRagHealth(true);
  const [prompt, setPrompt] = useState('');
  const [temperature, setTemperature] = useState(0.2);
  const [ragTopK, setRagTopK] = useState(() => {
    const raw = parseInt(
      typeof window !== 'undefined' && localStorage.getItem('rag.top_k'),
      10,
    );
    return Number.isFinite(raw) && raw >= 1 && raw <= 20 ? raw : 3;
  });
  const [selectedRagAgents, setSelectedRagAgents] = useState([]);
  const [ragMinScore, setRagMinScore] = useState(() => {
    const raw = parseFloat(
      typeof window !== 'undefined' && localStorage.getItem('rag.min_score'),
    );
    return Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : 1.0;
  });

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem('rag.top_k', String(ragTopK));
        localStorage.setItem('rag.min_score', String(ragMinScore));
      } catch (err) {
        console.error('[rag] persist params failed:', err);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [ragTopK, ragMinScore]);

  const onPromptConsumedRef = useRef(onPromptConsumed);
  useEffect(() => { onPromptConsumedRef.current = onPromptConsumed; });

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
      const ragOpts = useRag
        ? { ragTopK, ragMinScore, ...(selectedRagAgents.length > 0 ? { ragAgents: selectedRagAgents } : {}) }
        : {};
      onSubmit(prompt.trim(), temperature, { ...ragOpts, ...opts });
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    submitPrompt();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitPrompt();
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
          {loading ? 'BROADCASTING...' : 'BROADCAST'}
        </Button>
        <Button
          variant="outline-accent"
          size="md"
          type="button"
          disabled={loading || disabled || !canContinue}
          onClick={() => onQualityPass?.(temperature)}
          title={canContinue ? 'Review and correct the previous output in this session' : 'Run a broadcast first to start a session'}
        >
          QUALITY PASS
        </Button>
      </div>
    </form>
  );
}

export default React.memo(PromptInput);
