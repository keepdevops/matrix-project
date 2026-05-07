import React, { useState, useEffect } from 'react';
import { setAgentSystemPrompt } from '../api/swarmApi';

// Edits an agent's system prompt at runtime. Persists to active + source
// config so changes survive coordinator restart and UI redeploy.
//
// Why this matters: foreman's system_prompt is the single biggest lever on
// router quality, and previously could only be tuned by editing JSON on
// disk. Same modal works for any agent — useful for A/B testing role
// definitions without redeploying.
export default function AgentPromptModal({ agent, defaultPrompt, onClose, onSaved }) {
  const [text, setText] = useState(agent?.system_prompt || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setText(agent?.system_prompt || '');
    setError(null);
  }, [agent]);

  if (!agent) return null;

  const dirty = text !== (agent.system_prompt || '');
  const canResetDefault = defaultPrompt && defaultPrompt !== text;

  const save = async () => {
    setBusy(true); setError(null);
    try {
      await setAgentSystemPrompt(agent.name, text);
      if (onSaved) onSaved(text);
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 'min(720px, 92vw)', maxHeight: '85vh',
          background: '#0d0d0d', border: '1px solid #444',
          borderRadius: '6px', display: 'flex', flexDirection: 'column',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0.5rem 0.75rem', borderBottom: '1px solid #333',
        }}>
          <div>
            <strong>SYSTEM PROMPT — {agent.name}</strong>
            <span style={{ marginLeft: '0.5rem', opacity: 0.6, fontSize: '0.8rem' }}>
              :{agent.port}
            </span>
          </div>
          <button onClick={onClose} style={{ padding: '0.2rem 0.5rem' }}>✕</button>
        </div>

        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          spellCheck={false}
          style={{
            flex: 1, minHeight: '320px',
            padding: '0.6rem', background: '#000', color: '#dde',
            border: 'none', resize: 'vertical',
            fontFamily: 'monospace', fontSize: '0.85rem',
            lineHeight: 1.4,
          }}
        />

        <div style={{
          display: 'flex', alignItems: 'center', gap: '0.5rem',
          padding: '0.5rem 0.75rem', borderTop: '1px solid #333',
        }}>
          <span style={{ fontSize: '0.78rem', opacity: 0.7 }}>
            {text.length} chars · {text.split(/\s+/).filter(Boolean).length} words
          </span>
          {canResetDefault && (
            <button
              onClick={() => setText(defaultPrompt)}
              disabled={busy}
              style={{ padding: '0.25rem 0.6rem' }}
            >
              Revert to default
            </button>
          )}
          <span style={{ flex: 1 }} />
          {error && (
            <span style={{ color: '#ff7777', fontSize: '0.8rem' }}>{error}</span>
          )}
          <button onClick={onClose} disabled={busy}
                  style={{ padding: '0.25rem 0.7rem' }}>
            Cancel
          </button>
          <button
            onClick={save}
            disabled={busy || !dirty}
            className="swarm-deploy-btn"
            style={{ padding: '0.25rem 0.7rem' }}
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
