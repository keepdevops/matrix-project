import React from 'react';
import Button from './Button';

export default function PresetRow({ name, bundle, busy, onApply, onDelete }) {
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
      <Button variant="outline-primary" size="sm" className="preset-row-apply"
        onClick={() => onApply(name)} disabled={busy}>
        Apply
      </Button>
      <Button variant="outline-error" size="xs" className="preset-row-delete"
        onClick={() => onDelete(name)} disabled={busy}>
        ✕
      </Button>
    </div>
  );
}
