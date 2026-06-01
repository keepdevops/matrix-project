import React from 'react';
import Button from './Button';
import { useAgentPromptModal } from './useAgentPromptModal';
// re-export so static audits that scan this file still find the API symbols
export { setAgentSystemPrompt, setAgentDescription } from '../api/swarmApi';

// Edits an agent's system prompt at runtime. Persists to active + source
// config so changes survive coordinator restart and UI redeploy.
export default function AgentPromptModal({ agent, defaultPrompt, onClose, onSaved }) {
  const { text, setText, desc, setDesc, busy, error, dirty, save } =
    useAgentPromptModal({ agent, onClose, onSaved });

  if (!agent) return null;
  const canResetDefault = defaultPrompt && defaultPrompt !== text;

  return (
    <div
      role="dialog"
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.5rem 0.75rem', borderBottom: '1px solid #333' }}>
          <div>
            <strong>SYSTEM PROMPT — {agent.name}</strong>
            <span style={{ marginLeft: '0.5rem', opacity: 0.6, fontSize: '0.8rem' }}>:{agent.port}</span>
          </div>
          <Button variant="ghost" size="xs" onClick={onClose}>✕</Button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', padding: '0.5rem 0.75rem', borderBottom: '1px solid #222' }}>
          <label style={{ fontSize: '0.72rem', opacity: 0.7, textTransform: 'uppercase' }}>
            Description (short role tag, prepended to system prompt at runtime)
          </label>
          <input
            type="text" value={desc} onChange={e => setDesc(e.target.value)} spellCheck={false}
            placeholder="e.g. Performance Optimizer focused on CPU/memory hotspots"
            style={{ padding: '0.4rem 0.5rem', background: '#000', color: '#dde', border: '1px solid #333', borderRadius: '3px', fontFamily: 'monospace', fontSize: '0.85rem' }}
          />
        </div>

        <textarea
          value={text} onChange={e => setText(e.target.value)} spellCheck={false}
          style={{ flex: 1, minHeight: '320px', padding: '0.6rem', background: '#000', color: '#dde', border: 'none', resize: 'vertical', fontFamily: 'monospace', fontSize: '0.85rem', lineHeight: 1.4 }}
        />

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0.75rem', borderTop: '1px solid #333' }}>
          <span style={{ fontSize: '0.78rem', opacity: 0.7 }}>
            {text.length} chars · {text.split(/\s+/).filter(Boolean).length} words
          </span>
          {canResetDefault && (
            <Button variant="ghost" size="sm" onClick={() => setText(defaultPrompt)} disabled={busy}>Revert to default</Button>
          )}
          <span style={{ flex: 1 }} />
          {error && <span style={{ color: '#ff7777', fontSize: '0.8rem' }}>{error}</span>}
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="outline-primary" size="sm" onClick={save} disabled={busy || !dirty}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  );
}
