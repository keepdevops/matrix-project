import React from 'react';

export default function BrewAgentCardBody({
  showModelSelect, models, modelPath, onModelChange,
  displayModel, meta, onEdit, onExpand, children,
}) {
  return (
    <>
      {showModelSelect && models.length > 0 ? (
        <select
          className="brew-agent-card-model-select"
          value={modelPath || ''}
          onClick={e => e.stopPropagation()}
          onChange={e => { e.stopPropagation(); onModelChange?.(e.target.value); }}
        >
          <option value="" disabled>Select model…</option>
          {Array.from(new Set(models.map(m => m.backend))).map(backend => (
            <optgroup key={backend} label={backend}>
              {models.filter(m => m.backend === backend).map(m => (
                <option key={m.path} value={m.path}>{m.name}</option>
              ))}
            </optgroup>
          ))}
        </select>
      ) : (
        <div className="brew-agent-card-model" title={displayModel}>
          {displayModel}
        </div>
      )}

      <div className="brew-agent-card-footer">
        {onEdit && (
          <button
            type="button"
            className="brew-agent-card-edit"
            onClick={e => { e.stopPropagation(); onEdit(e); }}
          >
            Edit
          </button>
        )}
        {onExpand && (
          <button
            type="button"
            className="brew-agent-card-edit brew-agent-card-expand"
            onClick={e => { e.stopPropagation(); onExpand(e); }}
            title="View result"
          >⤢</button>
        )}
        <span className="brew-agent-card-meta">{meta}</span>
      </div>

      {children ? <div className="brew-agent-card-body">{children}</div> : null}
    </>
  );
}
