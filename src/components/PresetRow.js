import React from 'react';
import PresetActions from './PresetActions';

export default function PresetRow({ name, bundle, busy, onApply, onDelete, onDuplicated }) {
  return (
    <div className="preset-row">
      <div className="preset-row-info">
        <div className="preset-row-name">{name}</div>
        <div className="preset-row-meta">
          mode={bundle.mode}
          {Array.isArray(bundle.agents) && ` · ${bundle.agents.length} agent${bundle.agents.length === 1 ? '' : 's'}`}
          {bundle.synthesizer && ` · synth=${bundle.synthesizer}`}
          {Number.isInteger(bundle.max_select) && ` · max=${bundle.max_select}`}
        </div>
      </div>
      <PresetActions name={name} busy={busy}
        onApply={onApply} onDelete={onDelete} onDuplicated={onDuplicated} />
    </div>
  );
}
