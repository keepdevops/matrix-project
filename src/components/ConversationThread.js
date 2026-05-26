import React, { useState, useRef, useEffect, useCallback } from 'react';
import Button from './Button';

const METADATA_KEYS = new Set(['prompt', 'temperature', 'timestamp', '_final', '_mode',
  '_session_id', '_run_id']);

function bestAgentText(entry) {
  let best = '';
  for (const [k, v] of Object.entries(entry)) {
    if (!METADATA_KEYS.has(k) && typeof v === 'string' && v.length > best.length) best = v;
  }
  return best || null;
}

// Group history entries by session_id, returning [{sessionId, firstPrompt, timestamp, count}]
function buildSessionList(history) {
  const map = new Map();
  for (const e of history) {
    const sid = e._session_id;
    if (!sid) continue;
    if (!map.has(sid)) {
      map.set(sid, { sessionId: sid, firstPrompt: e.prompt || '', timestamp: e.timestamp, count: 0 });
    }
    map.get(sid).count++;
  }
  // Most recent first
  return Array.from(map.values()).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
}

function AgentExpander({ entry }) {
  const [open, setOpen] = useState(false);
  const agentKeys = Object.keys(entry).filter(k => !METADATA_KEYS.has(k) && entry[k]);
  if (!agentKeys.length) return null;
  return (
    <div className="ct-agent-expander">
      <Button variant="ghost" size="xs" className="ct-expand-btn" onClick={() => setOpen(v => !v)}>
        {open ? '▼' : '▶'} {agentKeys.length} agent{agentKeys.length !== 1 ? 's' : ''}
      </Button>
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

function Turn({ entry, finalAnswer }) {
  const synth = entry._final || finalAnswer || null;
  const fallback = !synth ? bestAgentText(entry) : null;
  const swarmText = synth || fallback;
  const isFallback = !synth && !!fallback;

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
        {swarmText
          ? <>
              {isFallback && <span className="ct-fallback-label">best agent · </span>}
              <span className="ct-bubble-text">{swarmText.length > 280 ? swarmText.slice(0, 280) + '…' : swarmText}</span>
            </>
          : <span className="ct-bubble-empty">—</span>
        }
      </div>
      <AgentExpander entry={entry} />
    </div>
  );
}

// Pending turn: shown immediately when a prompt is in-flight, before history refreshes.
function PendingTurn({ prompt }) {
  return (
    <div className="ct-turn ct-turn--pending">
      <div className="ct-bubble ct-bubble--user">
        <span className="ct-bubble-label">YOU</span>
        <span className="ct-bubble-text">{prompt}</span>
      </div>
      <div className="ct-bubble ct-bubble--swarm">
        <span className="ct-bubble-label">SWARM</span>
        <span className="ct-thinking">thinking…</span>
      </div>
    </div>
  );
}

function ReplyBox({ onSubmit, loading, disabled, lastEntry }) {
  const [text, setText] = useState('');
  const textareaRef = useRef(null);

  const handleSubmit = useCallback((e) => {
    e.preventDefault();
    if (!text.trim() || loading || disabled) return;
    const include = ['original_prompt', 'final'];
    if (lastEntry) {
      const agentKey = Object.keys(lastEntry).find(k => !METADATA_KEYS.has(k) && lastEntry[k]);
      if (agentKey) include.push(agentKey);
    }
    onSubmit(text.trim(), { include, max_context_chars: 20000 });
    setText('');
  }, [text, loading, disabled, lastEntry, onSubmit]);

  useEffect(() => {
    if (!loading) textareaRef.current?.focus();
  }, [loading]);

  return (
    <form className="ct-reply-form" onSubmit={handleSubmit}>
      <div className="ct-reply-row">
        <textarea
          ref={textareaRef}
          className="ct-reply-input"
          rows={2}
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="Follow up… (Enter to send, Shift+Enter for newline)"
          disabled={loading || disabled}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(e); }
          }}
        />
        <Button
          type="submit"
          variant="outline-primary"
          size="xs"
          disabled={loading || disabled || !text.trim()}
        >
          {loading ? '…' : 'SEND'}
        </Button>
      </div>
    </form>
  );
}

function SessionSwitcher({ history, currentSessionId, onSwitch }) {
  const [open, setOpen] = useState(false);
  const sessions = buildSessionList(history);
  const ref = useRef(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  if (sessions.length <= 1) return null;

  return (
    <div className="ct-session-switcher" ref={ref}>
      <Button
        variant="ghost"
        size="xs"
        onClick={() => setOpen(v => !v)}
        title="Switch to a previous session"
      >
        ▾ sessions ({sessions.length})
      </Button>
      {open && (
        <div className="ct-session-list">
          {sessions.map(s => (
            <button
              key={s.sessionId}
              className={`ct-session-item${s.sessionId === currentSessionId ? ' ct-session-item--active' : ''}`}
              onClick={() => { onSwitch(s.sessionId); setOpen(false); }}
            >
              <span className="ct-session-item-prompt">
                {s.firstPrompt.length > 48 ? s.firstPrompt.slice(0, 48) + '…' : s.firstPrompt}
              </span>
              <span className="ct-session-item-meta">
                {s.count} turn{s.count !== 1 ? 's' : ''} · {s.sessionId.slice(-6)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ConversationThread({
  history, sessionId, responses, finalAnswer, loading, pendingPrompt,
  onFollowUp, onClear, onSwitchSession,
}) {
  const bottomRef = useRef(null);
  const turns = sessionId
    ? history.filter(e => e._session_id === sessionId)
    : [];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns.length, loading, pendingPrompt]);

  if (!sessionId) return null;

  const latestTurnIdx = turns.length - 1;
  const lastEntry = latestTurnIdx >= 0 ? turns[latestTurnIdx] : null;

  // Show pending turn when loading and the prompt isn't in history yet
  const latestInHistory = lastEntry?.prompt;
  const showPending = loading && pendingPrompt && pendingPrompt !== latestInHistory;

  return (
    <section className="conversation-thread">
      <header className="ct-header">
        <span className="ct-title">CONVERSATION</span>
        <span className="ct-session-id">{sessionId.slice(-8)}</span>
        <SessionSwitcher
          history={history}
          currentSessionId={sessionId}
          onSwitch={onSwitchSession}
        />
        <Button variant="ghost" size="xs" onClick={onClear} title="Clear session">✕ new session</Button>
      </header>
      <div className="ct-turns">
        {turns.map((entry, i) => (
          <Turn
            key={entry._run_id || i}
            entry={entry}
            finalAnswer={i === latestTurnIdx && !loading ? finalAnswer : null}
          />
        ))}
        {showPending && <PendingTurn prompt={pendingPrompt} />}
        {loading && !showPending && (
          <div className="ct-bubble ct-bubble--swarm">
            <span className="ct-bubble-label">SWARM</span>
            <span className="ct-thinking">thinking…</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <ReplyBox
        onSubmit={onFollowUp}
        loading={loading}
        disabled={!sessionId}
        lastEntry={lastEntry}
      />
    </section>
  );
}
