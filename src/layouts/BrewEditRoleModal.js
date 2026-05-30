import React, { useState } from 'react';

const CTX_OPTIONS = [0, 4096, 8192, 16384, 32768];
const TABS = ['Basic', 'Advanced'];

function Toggle({ checked, onChange, id }) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      className={`brew-perm-toggle${checked ? ' on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="brew-perm-thumb" />
    </button>
  );
}

function SliderRow({ label, min, max, step, value, onChange, showToggle, toggleOn, onToggleChange }) {
  return (
    <div className="brew-adv-row">
      <span className="brew-adv-label">{label}</span>
      <input
        type="range"
        className="brew-adv-slider"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
      />
      {showToggle ? (
        <Toggle checked={toggleOn} onChange={onToggleChange} />
      ) : (
        <span className="brew-adv-value">{parseFloat(value).toFixed(step < 1 ? 2 : 0)}</span>
      )}
    </div>
  );
}

export default function BrewEditRoleModal({ role, models, roleModels, onClose, onSaved }) {
  const [tab, setTab]           = useState('Basic');

  // Basic
  const [name, setName]         = useState(role.name);
  const [prompt, setPrompt]     = useState(role.system_prompt || '');
  const [model, setModel]       = useState(roleModels[role.name] || '');
  const [context, setContext]   = useState(role.context ?? 0);

  // Advanced
  const [temp, setTemp]         = useState(role.temperature ?? 0.7);
  const [topP, setTopP]         = useState(role.top_p ?? 0.9);
  const [topK, setTopK]         = useState(role.top_k ?? 40);
  const [maxTok, setMaxTok]     = useState(role.max_tokens ?? 2048);
  const [maxTokOn, setMaxTokOn] = useState(Boolean(role.max_tokens));

  // Permissions
  const [perms, setPerms] = useState({
    webSearch:    role.permissions?.webSearch    ?? true,
    codeExec:     role.permissions?.codeExec     ?? true,
    dalleImage:   role.permissions?.dalleImage   ?? true,
    functionCall: role.permissions?.functionCall ?? false,
  });
  const togglePerm = key => setPerms(p => ({ ...p, [key]: !p[key] }));

  const handleSave = () => {
    onSaved({
      name,
      system_prompt: prompt,
      model,
      temperature: parseFloat(temp),
      context: parseInt(context, 10),
      top_p: parseFloat(topP),
      top_k: parseInt(topK, 10),
      max_tokens: maxTokOn ? parseInt(maxTok, 10) : null,
      permissions: { ...perms },
    });
    onClose();
  };

  return (
    <div className="brew-modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="brew-modal-card brew-modal-card--wide" role="dialog" aria-modal="true" aria-label={`Edit role ${role.name}`}>

        {/* Header */}
        <div className="brew-modal-header">
          <h2 className="brew-modal-title">
            <span className="brew-modal-title-plain">Role Editor</span>
          </h2>
          <button className="brew-modal-x" onClick={onClose} aria-label="Close">×</button>
        </div>

        {/* Tabs */}
        <div className="brew-modal-tabs">
          {TABS.map(t => (
            <button
              key={t}
              type="button"
              className={`brew-modal-tab${tab === t ? ' active' : ''}`}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="brew-modal-body">

          {tab === 'Basic' && (
            <>
              <div className="brew-modal-field">
                <label className="brew-modal-label" htmlFor="brew-role-name">Role Name</label>
                <input id="brew-role-name" className="brew-modal-input" type="text"
                  value={name} onChange={e => setName(e.target.value)} autoComplete="off" />
              </div>
              <div className="brew-modal-field">
                <label className="brew-modal-label" htmlFor="brew-role-prompt">System Prompt</label>
                <textarea id="brew-role-prompt" className="brew-modal-textarea"
                  value={prompt} onChange={e => setPrompt(e.target.value)}
                  rows={5} placeholder="Enter system prompt…" />
              </div>
              <div className="brew-modal-field">
                <label className="brew-modal-label" htmlFor="brew-role-model">Model Assignment</label>
                <select id="brew-role-model" className="brew-modal-select brew-modal-select--model"
                  value={model} onChange={e => setModel(e.target.value)}>
                  <option value="" disabled>Select model…</option>
                  {Array.from(new Set(models.map(m => m.backend))).map(backend => (
                    <optgroup key={backend} label={backend}>
                      {models.filter(m => m.backend === backend).map(m => (
                        <option key={m.path} value={m.path}>{m.name}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
              <div className="brew-modal-field brew-modal-field--row">
                <label className="brew-modal-label" htmlFor="brew-role-ctx">Context Window</label>
                <select id="brew-role-ctx" className="brew-modal-select"
                  value={context} onChange={e => setContext(e.target.value)}>
                  {CTX_OPTIONS.map(v => (
                    <option key={v} value={v}>{v === 0 ? '0 (default)' : v.toLocaleString()}</option>
                  ))}
                </select>
              </div>
            </>
          )}

          {tab === 'Advanced' && (
            <>
              <div className="brew-adv-card">
                <SliderRow label="Temperature" min={0} max={2}    step={0.01} value={temp}   onChange={setTemp} />
                <SliderRow label="Top-P"       min={0} max={1}    step={0.01} value={topP}   onChange={setTopP} />
                <SliderRow label="Top-K"       min={0} max={200}  step={1}    value={topK}   onChange={setTopK} />
                <SliderRow
                  label="Max Tokens" min={256} max={8192} step={256} value={maxTok} onChange={setMaxTok}
                  showToggle toggleOn={maxTokOn} onToggleChange={setMaxTokOn}
                />
              </div>

              <div className="brew-adv-card">
                <div className="brew-perm-title">Permissions</div>
                {[
                  ['webSearch',    'Web Search'],
                  ['codeExec',     'Code Execution'],
                  ['dalleImage',   'DALL-E Image Generation'],
                  ['functionCall', 'Function Calling'],
                ].map(([key, label]) => (
                  <div key={key} className="brew-perm-row">
                    <span className="brew-perm-label">{label}</span>
                    <Toggle checked={perms[key]} onChange={() => togglePerm(key)} />
                  </div>
                ))}
              </div>
            </>
          )}

        </div>

        {/* Footer */}
        <div className="brew-modal-footer">
          <button className="brew-modal-btn brew-modal-btn--cancel" onClick={onClose}>Cancel</button>
          <button className="brew-modal-btn brew-modal-btn--save" onClick={handleSave}>Save Changes</button>
        </div>

      </div>
    </div>
  );
}
