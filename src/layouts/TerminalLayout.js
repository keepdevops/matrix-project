import React, { useEffect, useRef, useState } from 'react';
import { LAYOUTS, THEMES } from './registry';
import HelpModal from '../components/HelpModal';
import RagAdmin from '../components/RagAdmin';
import CachePanel from '../components/CachePanel';
import SwarmConfig from '../components/SwarmConfig';
import './TerminalLayout.css';

function ts() {
  return new Date().toLocaleTimeString('en-US', { hour12: false });
}

function StatusLine({ online, activeMode, activeAgents, layout, theme, onSetLayout, onSetTheme }) {
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

function TerminalLine({ line }) {
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
  const [input, setInput] = useState('');
  const [cmdHistory, setCmdHistory] = useState([]);
  const [histIdx, setHistIdx] = useState(-1);
  const [lines, setLines] = useState([
    { kind: 'system', time: ts(), text: 'Swarm Matrix terminal. Type :help for commands.' },
  ]);
  const bottomRef = useRef(null);
  const inputRef  = useRef(null);

  // Append agent responses as they arrive
  const prevResponses = useRef({});
  useEffect(() => {
    const newLines = [];
    Object.entries(responses).forEach(([agent, text]) => {
      if (text && text !== prevResponses.current[agent]) {
        newLines.push({ kind: 'agent', time: ts(), agent, text });
      }
    });
    prevResponses.current = { ...responses };
    if (newLines.length) setLines(l => [...l, ...newLines]);
  }, [responses]);

  useEffect(() => {
    if (finalAnswer) {
      setLines(l => [...l, { kind: 'final', time: ts(), text: finalAnswer }]);
    }
  }, [finalAnswer]);

  useEffect(() => {
    if (error) setLines(l => [...l, { kind: 'error', time: ts(), text: error }]);
  }, [error]);

  useEffect(() => {
    if (pendingPrompt) {
      setLines(l => [...l, { kind: 'prompt', time: ts(), text: pendingPrompt }]);
    }
  }, [pendingPrompt]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines]);

  const sysLine = (text) => setLines(l => [...l, { kind: 'system', time: ts(), text }]);

  const BUILT_IN_CMDS = {
    ':help': () => sysLine(
      'Commands: :help  :clear  :mode <name>  :agents  :history  :rag  :config  :cache  :kv  :theme <name>  :layout <name>  — or type a prompt to submit'
    ),
    ':clear': () => setLines([{ kind: 'system', time: ts(), text: 'Terminal cleared.' }]),
    ':agents': () => sysLine(
      activeAgents.length
        ? activeAgents.map(a => `${a.name}(${a.backend})`).join('  ')
        : 'No agents online.'
    ),
    ':history': () => {
      if (!history.length) { sysLine('No history.'); return; }
      history.slice(-5).forEach(e => sysLine(`${e.timestamp ? new Date(e.timestamp).toLocaleString() : '?'}  ${e.prompt?.slice(0, 80)}`));
    },
    ':rag':    () => { onUseRagChange(!useRag); sysLine(`RAG ${!useRag ? 'enabled' : 'disabled'}.`); },
    ':config': () => { onToggleConfig(); sysLine('Config panel toggled in header.'); },
    ':cache':  () => { onOpenCachePanel(); sysLine('Cache panel opened.'); },
    ':kv':     () => {
      if (!kvReadings?.length) { sysLine('No KV readings.'); return; }
      kvReadings.forEach(r => sysLine(`port:${r.port}  usage:${(r.usage * 100).toFixed(1)}%  slots:${r.slots_busy}/${r.total_slots}`));
    },
  };

  const handleEnter = async () => {
    const cmd = input.trim();
    if (!cmd) return;
    setCmdHistory(h => [cmd, ...h.slice(0, 49)]);
    setHistIdx(-1);
    setInput('');

    if (BUILT_IN_CMDS[cmd]) { BUILT_IN_CMDS[cmd](); return; }

    if (cmd.startsWith(':mode ')) {
      const m = cmd.slice(6).trim();
      onModeChange(m);
      sysLine(`Mode set to ${m}.`);
      return;
    }
    if (cmd.startsWith(':theme ')) {
      onSetTheme(cmd.slice(7).trim());
      return;
    }
    if (cmd.startsWith(':layout ')) {
      onSetLayout(cmd.slice(8).trim());
      return;
    }
    if (cmd.startsWith(':follow ')) {
      await onFollowUp(cmd.slice(8).trim(), null);
      return;
    }
    if (cmd === ':session clear') { onClearSession(); sysLine('Session cleared.'); return; }

    if (cmd.startsWith(':')) { sysLine(`Unknown command: ${cmd}. Type :help`); return; }

    await onSubmit(cmd, 0.2, {});
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleEnter(); }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const idx = Math.min(histIdx + 1, cmdHistory.length - 1);
      setHistIdx(idx);
      setInput(cmdHistory[idx] ?? '');
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const idx = Math.max(histIdx - 1, -1);
      setHistIdx(idx);
      setInput(idx === -1 ? '' : cmdHistory[idx]);
    }
  };

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
