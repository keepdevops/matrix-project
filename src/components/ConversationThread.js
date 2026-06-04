import React, { useRef, useEffect, useMemo, memo } from 'react';
import Button from './Button';
// Orchestrate badge: entry._orchestrate, entry._mode, ct-mode-badge, 🐍 — impl in ConversationTurn.js
import { Turn, PendingTurn } from './ConversationTurn';
import { ReplyBox, SessionSwitcher } from './ConversationControls';

const ConversationThread = memo(function ConversationThread({
  history, sessionId, responses, finalAnswer, loading, pendingPrompt,
  onFollowUp, onClear, onSwitchSession, onForked,
}) {
  const bottomRef = useRef(null);
  const turns = useMemo(
    () => sessionId ? history.filter(e => e._session_id === sessionId) : [],
    [history, sessionId]
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns.length, loading, pendingPrompt]);

  if (!sessionId) return null;

  const latestTurnIdx = turns.length - 1;
  const lastEntry = latestTurnIdx >= 0 ? turns[latestTurnIdx] : null;

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
            key={entry._run_id ?? i}
            entry={entry}
            finalAnswer={i === latestTurnIdx && !loading ? finalAnswer : null}
            onForked={onForked}
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
});

export default ConversationThread;
