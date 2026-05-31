import React, { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react';
import Button from './Button';
import { buildSessionList, METADATA_KEYS } from '../utils/conversationHelpers';

export const ReplyBox = memo(function ReplyBox({ onSubmit, loading, disabled, lastEntry }) {
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
});

export const SessionSwitcher = memo(function SessionSwitcher({ history, currentSessionId, onSwitch }) {
  const [open, setOpen] = useState(false);
  const sessions = useMemo(() => buildSessionList(history), [history]);
  const ref = useRef(null);

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
            <Button
              key={s.sessionId}
              variant="ghost"
              size="xs"
              className={`ct-session-item${s.sessionId === currentSessionId ? ' ct-session-item--active' : ''}`}
              onClick={() => { onSwitch(s.sessionId); setOpen(false); }}
            >
              <span className="ct-session-item-prompt">
                {s.firstPrompt.length > 48 ? s.firstPrompt.slice(0, 48) + '…' : s.firstPrompt}
              </span>
              <span className="ct-session-item-meta">
                {s.count} turn{s.count !== 1 ? 's' : ''} · {s.sessionId.slice(-6)}
              </span>
            </Button>
          ))}
        </div>
      )}
    </div>
  );
});
