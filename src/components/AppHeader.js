import React, { useMemo } from 'react';
import ModeSelector from './ModeSelector';
import KvPressureGauge from './KvPressureGauge';
import MemoryPressureBadge from './MemoryPressureBadge';
import AppHeaderAppearance from './AppHeaderAppearance';
import Button from './Button';

const ENGINE_LABELS = { llama: 'LLAMA', mlx: 'MLX', vllm: 'vLLM', docker: 'DOCKER' };

function getRunningEngines(agents) {
  const backends = new Set();
  agents.forEach(a => { if (a.backend) backends.add(a.backend); });
  return [...backends].map(b => ENGINE_LABELS[b] || b).filter(Boolean);
}

export default function AppHeader({
  online, activeAgents, modes, activeMode,
  kvReadings, kvFetchFailed, cacheStatus,
  showConfigPanel, theme, layout, historyCount,
  warningsByMode, memoryPressure,
  onModeChange, onClearCache, onToggleConfig, onToggleHistory,
  onOpenConverter, onOpenRagAdmin, onOpenCachePanel, onOpenHelp,
  onSetTheme, onSetLayout,
}) {
  const engines = useMemo(() => getRunningEngines(activeAgents), [activeAgents]);

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
        <ModeSelector modes={modes} active={activeMode} onChange={onModeChange}
          disabled={!online} warningsByMode={warningsByMode} />
        <KvPressureGauge online={online} readings={kvReadings} fetchFailed={kvFetchFailed} />
        <MemoryPressureBadge pressure={memoryPressure} />
        <Button
          variant={cacheStatus === 'clearing' ? 'outline-warn' : cacheStatus === 'cleared' ? 'outline-primary' : cacheStatus === 'failed' ? 'outline-error' : 'outline-accent'}
          size="sm" onClick={onClearCache}
          disabled={cacheStatus === 'clearing' || !online}
        >
          {cacheStatus === 'clearing' ? 'CLEARING...' : cacheStatus === 'cleared' ? 'CLEARED' : cacheStatus === 'failed' ? 'FAILED' : 'CLEAR KV'}
        </Button>
        <Button variant="outline-orange" size="sm" className={showConfigPanel ? 'active' : ''} onClick={onToggleConfig}>
          CONFIGURE
        </Button>
        <Button variant="outline-primary" size="sm" onClick={onToggleHistory}>
          HISTORY ({historyCount})
        </Button>
        <Button variant="ghost" size="sm" onClick={onOpenConverter} title="Convert GGUF → MLX">⚙ Convert</Button>
        <Button variant="ghost" size="sm" onClick={onOpenRagAdmin} title="Upload/manage RAG documents">RAG DOCS</Button>
        <Button variant="ghost" size="sm" onClick={onOpenCachePanel} title="Inspect and manage the response cache">CACHE</Button>
        <Button variant="ghost" size="sm" className="btn--keep-mobile" onClick={onOpenHelp}>?</Button>
        <AppHeaderAppearance theme={theme} layout={layout} onSetTheme={onSetTheme} onSetLayout={onSetLayout} />
      </div>
    </header>
  );
}
