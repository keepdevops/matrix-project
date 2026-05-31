import React from 'react';
import { LAYOUTS, THEMES } from './registry';

export function ts() {
  return new Date().toLocaleTimeString('en-US', { hour12: false });
}

export function StatusLine({ online, activeMode, activeAgents, layout, theme, onSetLayout, onSetTheme }) {
  return (
    <div className="tl-statusline">
      <span className={`tl-status-dot ${online ? 'tl-dot-on' : 'tl-dot-off'}`}>●</span>
      <span className="tl-status-text">{online ? 'ONLINE' : 'OFFLINE'}</span>
      <span className="tl-status-sep">│</span>
      <span className="tl-status-text">MODE:{activeMode || '—'}</span>
      <span className="tl-status-sep">│</span>
      <span className="tl-status-text">AGENTS:{activeAgents.length}</span>
      <span className="tl-status-spacer" />
      <select
        className="tl-select"
        value={layout}
        onChange={e => onSetLayout(e.target.value)}
        title="Layout"
        aria-label="Layout"
      >
        {Object.entries(LAYOUTS).map(([id, { label }]) => (
          <option key={id} value={id}>{label}</option>
        ))}
      </select>
      <select
        className="tl-select"
        value={theme}
        onChange={e => onSetTheme(e.target.value)}
        title="Theme"
        aria-label="Theme"
      >
        {Object.entries(THEMES).map(([id, { label }]) => (
          <option key={id} value={id}>{label}</option>
        ))}
      </select>
    </div>
  );
}

export function TerminalLine({ line }) {
  return (
    <div className={`tl-line tl-line--${line.kind}`}>
      <span className="tl-time">[{line.time}]</span>
      {line.kind === 'prompt' && <span className="tl-prompt-sigil">$</span>}
      {line.kind === 'agent'  && <span className="tl-agent-tag">[{line.agent}]</span>}
      {line.kind === 'final'  && <span className="tl-agent-tag">[FINAL]</span>}
      {line.kind === 'system' && <span className="tl-agent-tag">[SYS]</span>}
      {line.kind === 'error'  && <span className="tl-agent-tag">[ERR]</span>}
      <span className="tl-line-text">{line.text}</span>
    </div>
  );
}
