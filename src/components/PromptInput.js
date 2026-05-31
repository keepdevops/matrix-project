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
  activeMode,
  submitLabel = 'BROADCAST',
  submitLoadingLabel = 'BROADCASTING...',
  qualityPassLabel = 'QUALITY PASS',
}) {
  const ragHealth = useRagHealth(true);
  const [prompt, setPrompt] = useState('');
  const [chunkCount, setChunkCount] = useState(3);
  // Role selectors for speculative, critic_debate, tree_of_thought modes.
  const [roleA, setRoleA] = useState('');  // drafter / generator
  const [roleB, setRoleB] = useState('');  // verifier / critic / scorer
  const [maxRounds, setMaxRounds] = useState(3);
  // tree_of_thought params
  const [totDepth, setTotDepth] = useState(2);
  const [totBranching, setTotBranching] = useState(3);
  const [totPruneBelow, setTotPruneBelow] = useState(4);
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

  const textareaRef = useRef(null);

  // Auto-grow the textarea to fit content so typed text is always visible.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [prompt]);

  const onPromptConsumedRef = useRef(onPromptConsumed);
  useEffect(() => { onPromptConsumedRef.current = onPromptConsumed; }, [onPromptConsumed]);

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
      const agentNames = activeAgents.map(a => a.name || a);
      const a = roleA || agentNames[0] || '';
      const b = roleB || agentNames[agentNames.length - 1] || agentNames[0] || '';
      const modeOpts =
        activeMode === 'map_reduce' ? { chunkCount } :
        activeMode === 'speculative' ? { modeParams: { drafter: a, verifier: b } } :
        activeMode === 'critic_debate' ? { modeParams: { generator: a, critic: b, max_rounds: maxRounds } } :
        activeMode === 'tree_of_thought' ? { modeParams: { generator: a, scorer: b, depth: totDepth, branching: totBranching, prune_below: totPruneBelow } } :
        {};
      onSubmit(prompt.trim(), temperature, { ...ragOpts, ...modeOpts, ...opts });
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
        {activeMode === 'map_reduce' && (
          <div className="temperature-control">
            <label htmlFor="chunk-count">
              Chunks: <span className="temp-value">{chunkCount}</span>
            </label>
            <input
              type="range"
              id="chunk-count"
              min="2"
              max="8"
              step="1"
              value={chunkCount}
              onChange={(e) => setChunkCount(Number(e.target.value))}
              disabled={loading || disabled}
              className="temperature-slider"
            />
          </div>
        )}
        {(['speculative', 'critic_debate', 'tree_of_thought'].includes(activeMode)) && activeAgents.length >= 2 && (() => {
          const names = activeAgents.map(a => a.name || a);
          const isTot = activeMode === 'tree_of_thought';
          const labelA = activeMode === 'speculative' ? 'Drafter' : 'Generator';
          const labelB = activeMode === 'speculative' ? 'Verifier' : isTot ? 'Scorer' : 'Critic';
          return (
            <>
              <div className="temperature-control" style={{ gap: '0.5rem' }}>
                <label>{labelA}:
                  <select value={roleA || names[0]} onChange={e => setRoleA(e.target.value)}
                    disabled={loading || disabled} style={{ marginLeft: '0.3rem', fontFamily: 'inherit', fontSize: '0.75rem' }}>
                    {names.map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
                <label style={{ marginLeft: '0.75rem' }}>{labelB}:
                  <select value={roleB || names[names.length - 1]} onChange={e => setRoleB(e.target.value)}
                    disabled={loading || disabled} style={{ marginLeft: '0.3rem', fontFamily: 'inherit', fontSize: '0.75rem' }}>
                    {names.map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
                {activeMode === 'critic_debate' && (
                  <label style={{ marginLeft: '0.75rem' }}>Rounds: <span className="temp-value">{maxRounds}</span>
                    <input type="range" min="1" max="5" step="1" value={maxRounds}
                      onChange={e => setMaxRounds(Number(e.target.value))}
                      disabled={loading || disabled} className="temperature-slider" style={{ width: '4rem' }} />
                  </label>
                )}
              </div>
              {isTot && (
                <div className="temperature-control" style={{ gap: '0.5rem' }}>
                  <label>Depth: <span className="temp-value">{totDepth}</span>
                    <input type="range" min="1" max="3" step="1" value={totDepth}
                      onChange={e => setTotDepth(Number(e.target.value))}
                      disabled={loading || disabled} className="temperature-slider" style={{ width: '4rem' }} />
                  </label>
                  <label style={{ marginLeft: '0.75rem' }}>Branches: <span className="temp-value">{totBranching}</span>
                    <input type="range" min="2" max="4" step="1" value={totBranching}
                      onChange={e => setTotBranching(Number(e.target.value))}
                      disabled={loading || disabled} className="temperature-slider" style={{ width: '4rem' }} />
                  </label>
                  <label style={{ marginLeft: '0.75rem' }}>Prune &lt;: <span className="temp-value">{totPruneBelow}</span>
                    <input type="range" min="0" max="9" step="1" value={totPruneBelow}
                      onChange={e => setTotPruneBelow(Number(e.target.value))}
                      disabled={loading || disabled} className="temperature-slider" style={{ width: '4rem' }} />
                  </label>
                </div>
              )}
            </>
          );
        })()}
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
