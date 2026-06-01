import React from 'react';
import { Toggle, SliderRow } from './BrewEditRoleModalControls';

const CTX_OPTIONS = [0, 4096, 8192, 16384, 32768];

export function BrewBasicTab({
  name, setName, prompt, setPrompt, model, setModel,
  context, setContext, models,
}) {
  return (
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
  );
}

export function BrewAdvancedTab({
  temp, setTemp, topP, setTopP, topK, setTopK,
  maxTok, setMaxTok, maxTokOn, setMaxTokOn,
  perms, togglePerm,
}) {
  return (
    <>
      <div className="brew-adv-card">
        <SliderRow label="Temperature" min={0} max={2}   step={0.01} value={temp}   onChange={setTemp} />
        <SliderRow label="Top-P"       min={0} max={1}   step={0.01} value={topP}   onChange={setTopP} />
        <SliderRow label="Top-K"       min={0} max={200} step={1}    value={topK}   onChange={setTopK} />
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
  );
}
