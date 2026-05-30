import React, { useMemo, useState } from 'react';
import ModeSelector from './ModeSelector';
import KvPressureGauge from './KvPressureGauge';
import { LAYOUTS, THEMES } from '../layouts/registry';
import Button from './Button';

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
  warningsByMode,
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
  const engines = useMemo(() => getRunningEngines(activeAgents), [activeAgents]);
  const themeEntries = useMemo(() => Object.entries(THEMES), []);
  const [showAppearance, setShowAppearance] = useState(false);

  return (
    <header>
      <h1>Swarm Matrix v{process.env.REACT_APP_VERSION || 'dev'}</h1>
      <div className="header-controls">
        <span role="status" aria-live="polite"
              className={`status-indicator btn--keep-mobile ${online ? 'status-online' : 'status-offline'}`}
              aria-label={online ? 'Status: online' : 'Status: offline'}>
          {online ? '● ONLINE' : '✕ OFFLINE'}
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
          warningsByMode={warningsByMode}
        />
        <KvPressureGauge online={online} readings={kvReadings} fetchFailed={kvFetchFailed} />
        <Button
          variant={cacheStatus === 'clearing' ? 'outline-warn' : cacheStatus === 'cleared' ? 'outline-primary' : cacheStatus === 'failed' ? 'outline-error' : 'outline-accent'}
          size="sm"
          onClick={onClearCache}
          disabled={cacheStatus === 'clearing' || !online}
        >
          {cacheStatus === 'clearing' ? 'CLEARING...'
            : cacheStatus === 'cleared' ? 'CLEARED'
            : cacheStatus === 'failed'  ? 'FAILED'
            : 'CLEAR KV'}
        </Button>
        <Button
          variant="outline-orange"
          size="sm"
          className={showConfigPanel ? 'active' : ''}
          onClick={onToggleConfig}
        >
          CONFIGURE
        </Button>
        <Button variant="outline-primary" size="sm" onClick={onToggleHistory}>
          HISTORY ({historyCount})
        </Button>
        <Button variant="ghost" size="sm" onClick={onOpenConverter} title="Convert GGUF → MLX">
          ⚙ Convert
        </Button>
        <Button variant="ghost" size="sm" onClick={onOpenRagAdmin} title="Upload/manage RAG documents">
          RAG DOCS
        </Button>
        <Button variant="ghost" size="sm" onClick={onOpenCachePanel} title="Inspect and manage the response cache">
          CACHE
        </Button>
        <Button variant="ghost" size="sm" className="btn--keep-mobile" onClick={onOpenHelp}>?</Button>

        <div className="appearance-picker" style={{ position: 'relative', display: 'inline-block' }}>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowAppearance(v => !v)}
            aria-label="Layout and theme"
            title="Pick layout and theme"
          >
            {THEMES[theme]?.label ?? '☾ Dark'}
          </Button>
          {showAppearance && (
            <div className="appearance-dropdown" style={{
              position: 'absolute', right: 0, top: '100%', zIndex: 200,
              background: 'var(--panel-bg, #161b22)', border: '1px solid var(--panel-border, #30363d)',
              borderRadius: 6, padding: '0.5rem', minWidth: 160,
            }}>
              <div style={{ fontSize: '0.7rem', opacity: 0.6, marginBottom: '0.4rem', textTransform: 'uppercase' }}>Theme</div>
              {themeEntries.map(([id, { label }]) => (
                <Button
                  key={id}
                  variant="ghost"
                  size="sm"
                  className={`appearance-option${theme === id ? ' active' : ''}`}
                  style={{ display: 'block', width: '100%', textAlign: 'left', fontWeight: theme === id ? 700 : 400 }}
                  onClick={() => { onSetTheme(id); setShowAppearance(false); }}
                >
                  {label}
                </Button>
              ))}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
