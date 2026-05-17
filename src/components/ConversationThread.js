import React, { useState, useRef, useEffect } from 'react';

const METADATA_KEYS = new Set(['prompt', 'temperature', 'timestamp', '_final', '_mode',
  '_session_id', '_run_id']);

function AgentExpander({ entry }) {
  const [open, setOpen] = useState(false);
  const agentKeys = Object.keys(entry).filter(k => !METADATA_KEYS.has(k) && entry[k]);
  if (!agentKeys.length) return null;
  return (
    <div className="ct-agent-expander">
      <button className="ct-expand-btn" onClick={() => setOpen(v => !v)}>
        {open ? '▼' : '▶'} {agentKeys.length} agent{agentKeys.length !== 1 ? 's' : ''}
      </button>
      {open && (
        <div className="ct-agent-tiles">
          {agentKeys.map(k => (
            <div key={k} className="ct-agent-tile">
              <div className="ct-agent-tile-name">{k}</div>
              <pre className="ct-agent-tile-body">{entry[k]}</pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Turn({ entry, isLatest, loading, finalAnswer }) {
  const swarmText = isLatest
    ? (loading ? null : (finalAnswer || entry._final || null))
    : (entry._final || null);

  return (
    <div className="ct-turn">
      <div className="ct-bubble ct-bubble--user">
        <span className="ct-bubble-label">YOU</span>
        <span className="ct-bubble-text">{entry.prompt}</span>
        {entry.timestamp && (
          <span className="ct-bubble-time">
            {new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>
      <div className="ct-bubble ct-bubble--swarm">
        <span className="ct-bubble-label">SWARM</span>
        {isLatest && loading
          ? <span className="ct-thinking">thinking…</span>
          : swarmText
            ? <span className="ct-bubble-text">{swarmText.length > 280 ? swarmText.slice(0, 280) + '…' : swarmText}</span>
            : <span className="ct-bubble-empty">—</span>
        }
      </div>
      {!loading && <AgentExpander entry={entry} />}
    </div>
  );
}

function ReplyBox({ onSubmit, loading, disabled }) {
  const [text, setText] = useState('');
  const [includeFinal, setIncludeFinal] = useState(true);
  const [includeOriginal, setIncludeOriginal] = useState(true);
  const textareaRef = useRef(null);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!text.trim() || loading || disabled) return;
    const include = [];
    if (includeOriginal) include.push('original_prompt');
    if (includeFinal) include.push('final');
    onSubmit(text.trim(), { include, max_context_chars: 20000 });
    setText('');
  };

  useEffect(() => {
    if (!loading) textareaRef.current?.focus();
  }, [loading]);

  return (
    <form className="ct-reply-form" onSubmit={handleSubmit}>
      <div className="ct-context-toggles">
        <label className="ct-toggle">
          <input type="checkbox" checked={includeOriginal} onChange={e => setIncludeOriginal(e.target.checked)} />
          original prompt
        </label>
        <label className="ct-toggle">
          <input type="checkbox" checked={includeFinal} onChange={e => setIncludeFinal(e.target.checked)} />
          final answer
        </label>
      </div>
      <div className="ct-reply-row">
        <textarea
          ref={textareaRef}
          className="ct-reply-input"
          rows={2}
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="Follow up…"
          disabled={loading || disabled}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(e); }
          }}
        />
        <button
          type="submit"
          className="ct-reply-btn"
          disabled={loading || disabled || !text.trim()}
        >
          {loading ? '…' : 'SEND'}
        </button>
      </div>
    </form>
  );
}

export default function ConversationThread({
  history, sessionId, responses, finalAnswer, loading, onFollowUp, onClear,
}) {
  const bottomRef = useRef(null);
  const turns = sessionId
    ? history.filter(e => e._session_id === sessionId)
    : [];

  // Append a synthetic "latest" entry if the current run isn't in history yet
  const latestInHistory = turns.length > 0 && turns[turns.length - 1];
  const currentPrompt = loading ? null : null; // resolved via turns once history updates
  const showLatestPending = loading && (turns.length === 0 || latestInHistory?._final);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns.length, loading]);

  if (!sessionId) return null;

  return (
    <section className="conversation-thread">
      <header className="ct-header">
        <span className="ct-title">CONVERSATION</span>
        <span className="ct-session-id">{sessionId.slice(-8)}</span>
        <button className="ct-clear-btn" onClick={onClear} title="Clear session">✕ new session</button>
      </header>
      <div className="ct-turns">
        {turns.map((entry, i) => (
          <Turn
            key={entry._run_id || i}
            entry={entry}
            isLatest={i === turns.length - 1}
            loading={loading && i === turns.length - 1}
            finalAnswer={finalAnswer}
          />
        ))}
        {showLatestPending && (
          <div className="ct-bubble ct-bubble--swarm">
            <span className="ct-bubble-label">SWARM</span>
            <span className="ct-thinking">thinking…</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <ReplyBox onSubmit={onFollowUp} loading={loading} disabled={!sessionId} />
    </section>
  );
}
