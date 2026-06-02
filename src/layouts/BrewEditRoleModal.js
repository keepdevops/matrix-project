import React from 'react';
import { BrewBasicTab, BrewAdvancedTab, BrewToolsTab } from './BrewEditRoleModalTabs';
import useBrewEditRoleModal from './useBrewEditRoleModal';

const TABS = ['Basic', 'Advanced', 'Tools'];

export default function BrewEditRoleModal({ role, models, roleModels, onClose, onSaved }) {
  const {
    tab, setTab, name, setName, prompt, setPrompt, model, setModel,
    context, setContext, temp, setTemp, minP, setMinP,
    topP, setTopP, topK, setTopK,
    maxTok, setMaxTok, maxTokOn, setMaxTokOn, perms, togglePerm,
    busy, error, handleSave,
  } = useBrewEditRoleModal({ role, roleModels, onClose, onSaved });

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
              temp={temp} setTemp={setTemp} minP={minP} setMinP={setMinP}
              topP={topP} setTopP={setTopP}
              topK={topK} setTopK={setTopK} maxTok={maxTok} setMaxTok={setMaxTok}
              maxTokOn={maxTokOn} setMaxTokOn={setMaxTokOn}
              perms={perms} togglePerm={togglePerm}
            />
          )}
          {tab === 'Tools' && (
            <BrewToolsTab perms={perms} togglePerm={togglePerm} />
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
