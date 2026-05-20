import React, { useState } from 'react';
import ModeSelector from './ModeSelector';
import KvPressureGauge from './KvPressureGauge';
import { LAYOUTS, THEMES } from '../layouts/registry';

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
  layout,
  historyCount,
  onModeChange,
  onClearCache,
  onToggleConfig,
  onToggleHistory,
  onOpenConverter,
  onOpenRagAdmin,
  onOpenCachePanel,
  onOpenHelp,
  onSetTheme,
  onSetLayout,
}) {
  const engines = getRunningEngines(activeAgents);
  const [showAppearance, setShowAppearance] = useState(false);

  const layoutEntries = Object.entries(LAYOUTS);
  const themeEntries  = Object.entries(THEMES);

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
        <button className="help-button" onClick={onOpenConverter} title="Convert GGUF → MLX">
          ⚙ Convert
        </button>
        <button className="help-button" onClick={onOpenRagAdmin} title="Upload/manage RAG documents">
          RAG DOCS
        </button>
        <button className="help-button" onClick={onOpenCachePanel} title="Inspect and manage the response cache">
          CACHE
        </button>
        <button className="help-button" onClick={onOpenHelp}>?</button>

        <div className="appearance-picker" style={{ position: 'relative', display: 'inline-block' }}>
          <button
            className="theme-toggle-button"
            onClick={() => setShowAppearance(v => !v)}
            aria-label="Layout and theme"
            title="Pick layout and theme"
          >
            {THEMES[theme]?.label ?? '☾ Dark'}
          </button>
          {showAppearance && (
            <div className="appearance-dropdown" style={{
              position: 'absolute', right: 0, top: '100%', zIndex: 200,
              background: 'var(--panel-bg, #161b22)', border: '1px solid #30363d',
              borderRadius: 6, padding: '0.5rem', minWidth: 160,
            }}>
              <div style={{ fontSize: '0.7rem', opacity: 0.6, marginBottom: '0.4rem', textTransform: 'uppercase' }}>Theme</div>
              {themeEntries.map(([id, { label }]) => (
                <button
                  key={id}
                  className={`appearance-option${theme === id ? ' active' : ''}`}
                  style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', color: 'inherit', padding: '0.3rem 0.5rem', cursor: 'pointer', borderRadius: 4, fontWeight: theme === id ? 700 : 400 }}
                  onClick={() => { onSetTheme(id); setShowAppearance(false); }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
