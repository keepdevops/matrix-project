import React from 'react';
import HelpModal from '../components/HelpModal';
import RagAdmin from '../components/RagAdmin';
import CachePanel from '../components/CachePanel';
import SwarmConfig from '../components/SwarmConfig';
import { StatusLine, TerminalLine, ts } from './terminalLayoutChrome';
import { useTerminalInput } from './useTerminalInput';
import './TerminalLayout.css';

export default function TerminalLayout({
  online, activeAgents, modes, activeMode, kvReadings,
  responses, finalAnswer, loading, error, history, lastMeta,
  currentSession, backend, switchBackend,
  showConfigPanel, showHelp, showRagAdmin, showCachePanel,
  cacheStatus, useRag, pendingPrompt,
  excludedBreaker,
  theme, layout, onSetTheme, onSetLayout,
  onModeChange, onClearCache,
  onToggleConfig, onToggleHistory,
  onOpenConverter, onOpenRagAdmin, onOpenCachePanel, onOpenHelp,
  onDeployed,
  onSubmit, onQualityPass,
  onFollowUp, onClearSession, onSwitchSession,
  onUseRagChange,
}) {
  const {
    input, setInput, lines, bottomRef, inputRef, handleEnter, handleKeyDown,
  } = useTerminalInput({
    responses, finalAnswer, error, pendingPrompt,
    activeAgents, history, kvReadings, useRag,
    onModeChange, onSetTheme, onSetLayout, onUseRagChange,
    onToggleConfig, onOpenCachePanel, onFollowUp, onClearSession, onSubmit,
  });

  return (
    <div className="tl-root" onClick={() => inputRef.current?.focus()}>
      <StatusLine
        online={online} activeMode={activeMode} activeAgents={activeAgents}
        layout={layout} theme={theme} onSetLayout={onSetLayout} onSetTheme={onSetTheme}
      />

      <div className="tl-output">
        {lines.map((line, i) => <TerminalLine key={i} line={line} />)}
        {loading && (
          <div className="tl-line tl-line--system">
            <span className="tl-time">[{ts()}]</span>
            <span className="tl-agent-tag">[SYS]</span>
            <span className="tl-line-text tl-blink">processing▋</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="tl-input-row">
        <span className="tl-prompt-sigil">$</span>
        <textarea
          ref={inputRef}
          className="tl-input"
          value={input}
          rows={1}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={online ? 'type a prompt or :command' : 'coordinator offline'}
          disabled={loading || !online}
          autoFocus
        />
        <button
          className="tl-send-btn"
          onClick={handleEnter}
          disabled={loading || !online || !input.trim()}
        >
          ↵
        </button>
      </div>

      {showHelp     && <HelpModal   onClose={onOpenHelp} />}
      {showRagAdmin && <RagAdmin    onClose={onOpenRagAdmin} />}
      {showCachePanel && <CachePanel onClose={onOpenCachePanel} />}
      {showConfigPanel && (
        <div className="tl-config-overlay">
          <SwarmConfig onDeployed={onDeployed} />
        </div>
      )}
    </div>
  );
}
