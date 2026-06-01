import React, { useState } from 'react';
import { setAgentSystemPrompt, setAgentTokens } from '../api/swarmApi';
import { BrewBasicTab, BrewAdvancedTab } from './BrewEditRoleModalTabs';

const TABS = ['Basic', 'Advanced'];

export default function BrewEditRoleModal({ role, models, roleModels, onClose, onSaved }) {
  const [tab, setTab] = useState('Basic');

  const [name, setName]         = useState(role.name);
  const [prompt, setPrompt]     = useState(role.system_prompt || '');
  const [model, setModel]       = useState(roleModels[role.name] || '');
  const [context, setContext]   = useState(role.context ?? 0);

  const [temp, setTemp]         = useState(role.temperature ?? 0.7);
  const [topP, setTopP]         = useState(role.top_p ?? 0.9);
  const [topK, setTopK]         = useState(role.top_k ?? 40);
  const [maxTok, setMaxTok]     = useState(role.max_tokens ?? 2048);
  const [maxTokOn, setMaxTokOn] = useState(Boolean(role.max_tokens));
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState(null);

  const [perms, setPerms] = useState({
    webSearch:    role.permissions?.webSearch    ?? true,
    codeExec:     role.permissions?.codeExec     ?? true,
    dalleImage:   role.permissions?.dalleImage   ?? true,
    functionCall: role.permissions?.functionCall ?? false,
  });
  const togglePerm = key => setPerms(p => ({ ...p, [key]: !p[key] }));

  const handleSave = async () => {
    const agentName = role.name;
    if (name.trim() !== agentName) {
      setError('Renaming agents is not supported — keep the original role name.');
      return;
    }
    setBusy(true);
    setError(null);
    const patch = { name: agentName, model };
    try {
      const promptDirty = prompt !== (role.system_prompt || '');
      if (promptDirty) {
        const r = await setAgentSystemPrompt(agentName, prompt);
        patch.system_prompt = (r && typeof r.system_prompt === 'string') ? r.system_prompt : prompt;
      }
      const ctxVal = parseInt(context, 10);
      const tokVal = maxTokOn ? parseInt(maxTok, 10) : null;
      const ctxDirty = ctxVal !== (role.context ?? 0);
      const tokDirty = (tokVal ?? null) !== (role.max_tokens ?? null);
      if (ctxDirty || tokDirty) {
        const body = {};
        if (ctxDirty) body.context = ctxVal;
        if (tokDirty && Number.isFinite(tokVal)) body.max_tokens = tokVal;
        const r = await setAgentTokens(agentName, body);
        if (Number.isFinite(r?.context)) patch.context = r.context;
        if (Number.isFinite(r?.max_tokens)) patch.max_tokens = r.max_tokens;
        else if (!maxTokOn) patch.max_tokens = null;
      }
      patch.temperature = parseFloat(temp);
      patch.top_p = parseFloat(topP);
      patch.top_k = parseInt(topK, 10);
      patch.permissions = { ...perms };
      onSaved(patch);
      onClose();
    } catch (e) {
      if (Object.keys(patch).length > 1) onSaved(patch);
      setError(e.message || 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="brew-modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="brew-modal-card brew-modal-card--wide" role="dialog" aria-modal="true" aria-label={`Edit role ${role.name}`}>

        <div className="brew-modal-header">
          <h2 className="brew-modal-title">
            <span className="brew-modal-title-plain">Role Editor</span>
          </h2>
          <button className="brew-modal-x" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="brew-modal-tabs">
          {TABS.map(t => (
            <button key={t} type="button"
              className={`brew-modal-tab${tab === t ? ' active' : ''}`}
              onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </div>

        <div className="brew-modal-body">
          {tab === 'Basic' && (
            <BrewBasicTab
              name={name} setName={setName} prompt={prompt} setPrompt={setPrompt}
              model={model} setModel={setModel} context={context} setContext={setContext}
              models={models}
            />
          )}
          {tab === 'Advanced' && (
            <BrewAdvancedTab
              temp={temp} setTemp={setTemp} topP={topP} setTopP={setTopP}
              topK={topK} setTopK={setTopK} maxTok={maxTok} setMaxTok={setMaxTok}
              maxTokOn={maxTokOn} setMaxTokOn={setMaxTokOn}
              perms={perms} togglePerm={togglePerm}
            />
          )}
        </div>

        <div className="brew-modal-footer">
          {error && (
            <span className="brew-modal-error" style={{ flex: 1, fontSize: '0.78rem', color: 'var(--brew-kv-crit)' }}>
              {error}
            </span>
          )}
          <button className="brew-modal-btn brew-modal-btn--cancel" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="brew-modal-btn brew-modal-btn--save" onClick={handleSave} disabled={busy}>
            {busy ? 'Saving…' : 'Save Changes'}
          </button>
        </div>

      </div>
    </div>
  );
}
