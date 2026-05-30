import React from 'react';

function modelShortName(path) {
  if (!path) return '—';
  const s = String(path);
  return s.includes('/') ? s.split('/').pop() : s;
}

/**
 * Shared Brewlate agent identity card (configure + runtime).
 */
export default function BrewAgentCard({
  name,
  model,
  modelPath,
  meta,
  selected = false,
  picked = false,
  pickable = false,
  onClick,
  onEdit,
  showModelSelect = false,
  models = [],
  onModelChange,
  children,
  className = '',
}) {
  const displayModel = model || modelShortName(modelPath);
  const cardClass = [
    'brew-agent-card',
    selected && 'selected',
    picked && 'picked',
    pickable && 'pickable',
    className,
  ].filter(Boolean).join(' ');

  const handleCardClick = (e) => {
    if (e.target.closest('select, button, a, input, textarea')) return;
    onClick?.(e);
  };

  return (
    <div
      className={cardClass}
      onClick={onClick ? handleCardClick : undefined}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(e); } } : undefined}
    >
      <div className="brew-agent-card-hero">
        <img
          src={`${process.env.PUBLIC_URL || ''}/images/brew-agent-cup.png`}
          alt=""
          className="brew-agent-card-cup"
          draggable={false}
        />
      </div>

      <div className="brew-agent-card-name">{name}</div>

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
        <span className="brew-agent-card-meta">{meta}</span>
        {onEdit && (
          <button
            type="button"
            className="brew-agent-card-edit"
            onClick={e => { e.stopPropagation(); onEdit(e); }}
          >
            Edit
          </button>
        )}
      </div>

      {children ? <div className="brew-agent-card-body">{children}</div> : null}
    </div>
  );
}

export { modelShortName };
