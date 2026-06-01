import React, { useMemo, useState } from 'react';
import ModeSelector from '../components/ModeSelector';
import KvPressureGauge from '../components/KvPressureGauge';
import MemoryPressureBadge from '../components/MemoryPressureBadge';
import BrewHeaderMenu from './BrewHeaderMenu';

const ENGINE_LABELS = { llama: 'LLAMA', mlx: 'MLX', vllm: 'vLLM', docker: 'DOCKER' };

function runningEngines(agents) {
  const backends = new Set();
  agents.forEach(a => { if (a.backend) backends.add(a.backend); });
  return [...backends].map(b => ENGINE_LABELS[b] || b).filter(Boolean);
}

export default function BrewHeader({
  online, activeAgents, modes, activeMode, warningsByMode,
  kvReadings, kvFetchFailed, memoryPressure, cacheStatus,
  historyCount, deployed, theme, layout,
  onModeChange, onClearCache, onToggleHistory,
  onOpenConverter, onOpenRagAdmin, onOpenCachePanel, onOpenHelp,
  onSetTheme, onSetLayout, onShowConfigure,
}) {
  const engines = useMemo(() => runningEngines(activeAgents), [activeAgents]);
  const [showMenu, setShowMenu] = useState(false);

  const kvLabel = cacheStatus === 'clearing' ? 'CLEARING…'
    : cacheStatus === 'cleared' ? 'CLEARED'
    : cacheStatus === 'failed'  ? 'FAILED'
    : 'CLEAR KV';

  return (
    <header className="brew-header">
      <span className="brew-logo">Brewlatte</span>

      <span className={`brew-status-pill${online ? ' online' : ''}`}
        role="status" aria-live="polite">
        {online ? '● ONLINE' : '✕ OFFLINE'}
      </span>

      {online && engines.length > 0 && (
        <span className="brew-engine-badge">{engines.join(' + ')}</span>
      )}

      <MemoryPressureBadge pressure={memoryPressure} />

      <div className="brew-header-spacer" />

      <div className="brew-header-mode">
        <ModeSelector modes={modes} active={activeMode} onChange={onModeChange}
          disabled={!online} warningsByMode={warningsByMode} />
      </div>

      <KvPressureGauge online={online} readings={kvReadings} fetchFailed={kvFetchFailed} />

      <button type="button" className="brew-header-btn"
        onClick={onToggleHistory} title="Recent prompts">
        HISTORY ({historyCount})
      </button>

      <button type="button"
        className={`brew-header-btn brew-header-btn--kv brew-header-btn--kv-${cacheStatus}`}
        onClick={onClearCache} disabled={cacheStatus === 'clearing' || !online}>
        {kvLabel}
      </button>

      {deployed && (
        <button type="button" className="brew-header-btn brew-header-btn--configure"
          onClick={onShowConfigure}>
          CONFIGURE
        </button>
      )}

      <BrewHeaderMenu
        showMenu={showMenu} setShowMenu={setShowMenu}
        theme={theme} layout={layout}
        onOpenConverter={onOpenConverter} onOpenRagAdmin={onOpenRagAdmin}
        onOpenCachePanel={onOpenCachePanel} onOpenHelp={onOpenHelp}
        onSetTheme={onSetTheme} onSetLayout={onSetLayout}
      />
    </header>
  );
}
