import React, { useState, useEffect, useRef } from 'react';
import useRagHealth from '../hooks/useRagHealth';

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
}) {
  const ragHealth = useRagHealth(true);
  const ragDown = !ragHealth.loading && !ragHealth.ok;
  const badgeColor = ragHealth.loading
    ? '#888'
    : ragHealth.ok
      ? '#3fb950'
      : '#f85149';
  const badgeTitle = ragHealth.loading
    ? 'Checking pgvector…'
    : ragHealth.ok
      ? `pgvector ok (embedder: ${ragHealth.embedder || 'unknown'})`
      : `pgvector unavailable${ragHealth.error ? `: ${ragHealth.error}` : ''}`;
  const [prompt, setPrompt] = useState('');
  const [temperature, setTemperature] = useState(0.2);
  const [ragTopK, setRagTopK] = useState(() => {
    const raw = parseInt(
      typeof window !== 'undefined' && localStorage.getItem('rag.top_k'),
      10,
    );
    return Number.isFinite(raw) && raw >= 1 && raw <= 20 ? raw : 3;
  });
  const [ragAgents, setRagAgents] = useState([]); // empty = all agents
  const [ragMinScore, setRagMinScore] = useState(() => {
    const raw = parseFloat(
      typeof window !== 'undefined' && localStorage.getItem('rag.min_score'),
    );
    return Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : 1.0;
  });
  useEffect(() => {
    try { localStorage.setItem('rag.top_k', String(ragTopK)); } catch (err) {
      console.error('[rag] persist top_k failed:', err);
    }
  }, [ragTopK]);
  useEffect(() => {
    try { localStorage.setItem('rag.min_score', String(ragMinScore)); } catch (err) {
      console.error('[rag] persist min_score failed:', err);
    }
  }, [ragMinScore]);
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
      const ragOpts = useRag
        ? { ragTopK, ragMinScore, ...(ragAgents.length > 0 ? { ragAgents } : {}) }
        : {};
      onSubmit(prompt.trim(), temperature, { ...ragOpts, ...opts });
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    submitPrompt();
  };

  const handleKeyDown = (e) => {
    // Enter submits; Shift+Enter inserts newline; Ctrl/Cmd+Enter also submits.
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
        <label
          className="rag-toggle"
          title={ragDown
            ? badgeTitle
            : 'Prepend retrieved pgvector chunks to the prompt (requires rag.enabled in coordinator config)'}
        >
          <span
            aria-label={badgeTitle}
            title={badgeTitle}
            style={{
              display: 'inline-block',
              width: '0.6rem',
              height: '0.6rem',
              borderRadius: '50%',
              backgroundColor: badgeColor,
              marginRight: '0.35rem',
              verticalAlign: 'middle',
            }}
          />
          <input
            type="checkbox"
            checked={useRag}
            onChange={(e) => onUseRagChange?.(e.target.checked)}
            disabled={loading || disabled || ragDown}
          />
          {' '}Use RAG context
        </label>
        {useRag && (
          <details className="rag-options" style={{ marginLeft: '0.5rem' }}>
            <summary style={{ cursor: 'pointer', userSelect: 'none', opacity: 0.8 }}>
              RAG options
            </summary>
            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.4rem', alignItems: 'center' }}>
              <label style={{ fontSize: '0.85rem' }}>
                top_k{' '}
                <input
                  type="number"
                  min={1}
                  max={20}
                  step={1}
                  value={ragTopK}
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10);
                    if (Number.isFinite(n)) {
                      setRagTopK(Math.max(1, Math.min(20, n)));
                    }
                  }}
                  disabled={loading || disabled}
                  style={{ width: '4rem' }}
                />
              </label>
              <label style={{ fontSize: '0.85rem' }}>
                min_score{' '}
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={ragMinScore}
                  onChange={(e) => {
                    const n = parseFloat(e.target.value);
                    if (Number.isFinite(n)) {
                      setRagMinScore(Math.max(0, Math.min(1, n)));
                    }
                  }}
                  disabled={loading || disabled}
                  style={{ width: '5rem' }}
                  title="Maximum cosine distance to accept (lower = stricter match)"
                />
              </label>
            </div>
            {activeAgents.length > 0 && (
              <div style={{ marginTop: '0.5rem' }}>
                <span style={{ fontSize: '0.78rem', opacity: 0.7 }}>
                  Target agents{' '}
                  <span style={{ fontSize: '0.7rem', opacity: 0.6 }}>(none = all)</span>:
                </span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: '0.25rem' }}>
                  {activeAgents.map(({ name }) => (
                    <label key={name} style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                      <input
                        type="checkbox"
                        checked={ragAgents.includes(name)}
                        onChange={(e) => {
                          setRagAgents(prev =>
                            e.target.checked ? [...prev, name] : prev.filter(n => n !== name)
                          );
                        }}
                        disabled={loading || disabled}
                      />
                      {name}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </details>
        )}
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

export default React.memo(PromptInput);
