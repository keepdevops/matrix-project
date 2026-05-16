import React from 'react';
import ModeSelector from './ModeSelector';
import KvPressureGauge from './KvPressureGauge';

const ENGINE_LABELS = { llama: 'LLAMA', mlx: 'MLX', vllm: 'vLLM', docker: 'DOCKER' };

function getRunningEngines(agents) {
  const backends = new Set();
  agents.forEach(a => { if (a.backend) backends.add(a.backend); });
  return [...backends].map(b => ENGINE_LABELS[b] || b).filter(Boolean);
}

export default function AppHeader({
  online,
  activeAgents,
  modes,
  activeMode,
  kvReadings,
  kvFetchFailed,
  cacheStatus,
  showConfigPanel,
  theme,
  historyCount,
  onModeChange,
  onClearCache,
  onToggleConfig,
  onToggleHistory,
  onOpenRagAdmin,
  onOpenCachePanel,
  onOpenHelp,
  onToggleTheme,
}) {
  const engines = getRunningEngines(activeAgents);

  return (
    <header>
      <h1>Swarm Matrix v{process.env.REACT_APP_VERSION || 'dev'}</h1>
      <div className="header-controls">
        <span className={`status-indicator ${online ? 'status-online' : 'status-offline'}`}>
          {online ? 'ONLINE' : 'OFFLINE'}
        </span>
        {online && engines.length > 0 && (
          <span className="engine-badge" title="Inference engine(s) in use">
            {engines.join(' + ')}
          </span>
        )}
        <ModeSelector
          modes={modes}
          active={activeMode}
          onChange={onModeChange}
          disabled={!online}
        />
        <KvPressureGauge online={online} readings={kvReadings} fetchFailed={kvFetchFailed} />
        <button
          className={`cache-button cache-button--${cacheStatus}`}
          onClick={onClearCache}
          disabled={cacheStatus === 'clearing' || !online}
        >
          {cacheStatus === 'clearing' ? 'CLEARING...'
            : cacheStatus === 'cleared' ? 'CLEARED'
            : cacheStatus === 'failed'  ? 'FAILED'
            : 'CLEAR KV'}
        </button>
        <button
          className={`configure-button ${showConfigPanel ? 'active' : ''}`}
          onClick={onToggleConfig}
        >
          CONFIGURE
        </button>
        <button className="history-button" onClick={onToggleHistory}>
          HISTORY ({historyCount})
        </button>
        <button
          className="help-button"
          onClick={onOpenRagAdmin}
          title="Upload/manage RAG documents"
        >
          RAG DOCS
        </button>
        <button
          className="help-button"
          onClick={onOpenCachePanel}
          title="Inspect and manage the response cache"
        >
          CACHE
        </button>
        <button className="help-button" onClick={onOpenHelp}>?</button>
        <button
          className="theme-toggle-button"
          onClick={onToggleTheme}
          aria-label="Toggle theme"
          title="Toggle light/dark mode"
        >
          {theme === 'dark' ? '☀ Light' : '☾ Dark'}
        </button>
      </div>
    </header>
  );
}
