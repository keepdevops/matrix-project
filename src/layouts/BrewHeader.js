import React, { useMemo, useState } from 'react';
import ModeSelector from '../components/ModeSelector';
import { LAYOUTS, THEMES } from './registry';

const ENGINE_LABELS = { llama: 'LLAMA', mlx: 'MLX', vllm: 'vLLM', docker: 'DOCKER' };

function runningEngines(agents) {
  const backends = new Set();
  agents.forEach(a => { if (a.backend) backends.add(a.backend); });
  return [...backends].map(b => ENGINE_LABELS[b] || b).filter(Boolean);
}

export default function BrewHeader({
  online,
  activeAgents,
  modes,
  activeMode,
  warningsByMode,
  cacheStatus,
  historyCount,
  deployed,
  theme,
  layout,
  onModeChange,
  onClearCache,
  onToggleHistory,
  onOpenConverter,
  onOpenRagAdmin,
  onOpenCachePanel,
  onOpenHelp,
  onSetTheme,
  onSetLayout,
  onShowConfigure,
}) {
  const engines = useMemo(() => runningEngines(activeAgents), [activeAgents]);
  const [showMenu, setShowMenu] = useState(false);
  const themeEntries = useMemo(() => Object.entries(THEMES), []);
  const layoutEntries = useMemo(() => Object.entries(LAYOUTS), []);

  const kvLabel = cacheStatus === 'clearing' ? 'CLEARING…'
    : cacheStatus === 'cleared' ? 'CLEARED'
    : cacheStatus === 'failed'  ? 'FAILED'
    : 'CLEAR KV';

  return (
    <header className="brew-header">
      <span className="brew-logo">Brewlatte</span>

      <span
        className={`brew-status-pill${online ? ' online' : ''}`}
        role="status"
        aria-live="polite"
      >
        {online ? '● ONLINE' : '✕ OFFLINE'}
      </span>

      {online && engines.length > 0 && (
        <span className="brew-engine-badge">{engines.join(' + ')}</span>
      )}

      <div className="brew-header-spacer" />

      <div className="brew-header-mode">
        <ModeSelector
          modes={modes}
          active={activeMode}
          onChange={onModeChange}
          disabled={!online}
          warningsByMode={warningsByMode}
        />
      </div>

      <button
        type="button"
        className="brew-header-btn"
        onClick={onToggleHistory}
        title="Recent prompts"
      >
        HISTORY ({historyCount})
      </button>

      <button
        type="button"
        className={`brew-header-btn brew-header-btn--kv brew-header-btn--kv-${cacheStatus}`}
        onClick={onClearCache}
        disabled={cacheStatus === 'clearing' || !online}
      >
        {kvLabel}
      </button>

      {deployed && (
        <button
          type="button"
          className="brew-header-btn brew-header-btn--configure"
          onClick={onShowConfigure}
        >
          CONFIGURE
        </button>
      )}

      <div className="brew-header-menu-wrap">
        <button
          type="button"
          className="brew-header-btn"
          onClick={() => setShowMenu(v => !v)}
          aria-expanded={showMenu}
          aria-label="Utilities"
        >
          {THEMES[theme]?.label ?? '☾ Dark'} ▾
        </button>
        {showMenu && (
          <div className="brew-header-dropdown">
            <div className="brew-header-dropdown-label">Tools</div>
            <button type="button" className="brew-header-dropdown-item" onClick={() => { onOpenConverter?.(); setShowMenu(false); }}>
              Convert GGUF → MLX
            </button>
            <button type="button" className="brew-header-dropdown-item" onClick={() => { onOpenRagAdmin?.(); setShowMenu(false); }}>
              RAG Docs
            </button>
            <button type="button" className="brew-header-dropdown-item" onClick={() => { onOpenCachePanel?.(); setShowMenu(false); }}>
              Response Cache
            </button>
            <button type="button" className="brew-header-dropdown-item" onClick={() => { onOpenHelp?.(); setShowMenu(false); }}>
              Help (?)
            </button>
            <div className="brew-header-dropdown-label">Layout</div>
            {layoutEntries.map(([id, { label }]) => (
              <button
                key={id}
                type="button"
                className={`brew-header-dropdown-item${layout === id ? ' active' : ''}`}
                onClick={() => { onSetLayout?.(id); setShowMenu(false); }}
              >
                {label}
              </button>
            ))}
            <div className="brew-header-dropdown-label">Theme</div>
            {themeEntries.map(([id, { label }]) => (
              <button
                key={id}
                type="button"
                className={`brew-header-dropdown-item${theme === id ? ' active' : ''}`}
                onClick={() => { onSetTheme?.(id); setShowMenu(false); }}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
    </header>
  );
}
