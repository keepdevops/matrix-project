import React, { useState, useEffect } from 'react';
import Button from './Button';
import { setAgentSystemPrompt, setAgentDescription } from '../api/swarmApi';

// Edits an agent's system prompt at runtime. Persists to active + source
// config so changes survive coordinator restart and UI redeploy.
//
// Why this matters: foreman's system_prompt is the single biggest lever on
// router quality, and previously could only be tuned by editing JSON on
// disk. Same modal works for any agent — useful for A/B testing role
// definitions without redeploying.
export default function AgentPromptModal({ agent, defaultPrompt, onClose, onSaved }) {
  const [text, setText] = useState(agent?.system_prompt || '');
  const [desc, setDesc] = useState(agent?.description || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setText(agent?.system_prompt || '');
    setDesc(agent?.description || '');
    setError(null);
  }, [agent]);

  if (!agent) return null;

  const promptDirty = text !== (agent.system_prompt || '');
  const descDirty = desc !== (agent.description || '');
  const dirty = promptDirty || descDirty;
  const canResetDefault = defaultPrompt && defaultPrompt !== text;

  const save = async () => {
    setBusy(true); setError(null);
    // Track partial success: if description saves but prompt fails, the parent
    // still needs the description update so its row doesn't show stale text.
    const patch = {};
    try {
      if (descDirty) {
        const r = await setAgentDescription(agent.name, desc);
        patch.description = (r && typeof r.description === 'string') ? r.description : desc;
      }
      if (promptDirty) {
        const r = await setAgentSystemPrompt(agent.name, text);
        patch.system_prompt = (r && typeof r.system_prompt === 'string') ? r.system_prompt : text;
      }
      if (onSaved && Object.keys(patch).length) onSaved(patch);
      onClose();
    } catch (e) {
      if (onSaved && Object.keys(patch).length) onSaved(patch);
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
          <Button variant="ghost" size="xs" onClick={onClose}>✕</Button>
        </div>

        <div style={{
          display: 'flex', flexDirection: 'column', gap: '0.25rem',
          padding: '0.5rem 0.75rem', borderBottom: '1px solid #222',
        }}>
          <label style={{ fontSize: '0.72rem', opacity: 0.7, textTransform: 'uppercase' }}>
            Description (short role tag, prepended to system prompt at runtime)
          </label>
          <input
            type="text"
            value={desc}
            onChange={e => setDesc(e.target.value)}
            placeholder="e.g. Performance Optimizer focused on CPU/memory hotspots"
            spellCheck={false}
            style={{
              padding: '0.4rem 0.5rem', background: '#000', color: '#dde',
              border: '1px solid #333', borderRadius: '3px',
              fontFamily: 'monospace', fontSize: '0.85rem',
            }}
          />
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
            <Button variant="ghost" size="sm" onClick={() => setText(defaultPrompt)} disabled={busy}>
              Revert to default
            </Button>
          )}
          <span style={{ flex: 1 }} />
          {error && (
            <span style={{ color: '#ff7777', fontSize: '0.8rem' }}>{error}</span>
          )}
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="outline-primary" size="sm" onClick={save} disabled={busy || !dirty}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  );
}
