import React from 'react';
import BrewAgentCardBody from './BrewAgentCardBody';

function modelShortName(path) {
  if (!path) return '—';
  const s = String(path);
  return s.includes('/') ? s.split('/').pop() : s;
}

/**
 * Shared Brewlatte agent identity card (configure + runtime).
 */
export default function BrewAgentCard({
  name,
  model,
  modelPath,
  meta,
  selected = false,
  picked = false,
  pickable = false,
  hasResult = false,
  onClick,
  onEdit,
  onExpand,
  showModelSelect = false,
  showCheckbox = false,
  checked = false,
  models = [],
  onModelChange,
  hasCode = false,
  children,
  className = '',
}) {
  const displayModel = model || modelShortName(modelPath);
  const cardClass = [
    'brew-agent-card',
    selected && 'selected',
    picked && 'picked',
    pickable && 'pickable',
    hasResult && 'brew-agent-card--has-result',
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

      <div className="brew-agent-card-name-row">
        {showCheckbox && (
          <input
            type="checkbox"
            className="brew-agent-card-check"
            checked={checked}
            readOnly
            tabIndex={-1}
            aria-hidden
          />
        )}
        <div className="brew-agent-card-name">{name}</div>
        {hasCode && <span className="brew-code-badge" title="Fenced code available">CODE</span>}
      </div>

      <BrewAgentCardBody
        showModelSelect={showModelSelect} models={models}
        modelPath={modelPath} onModelChange={onModelChange}
        displayModel={displayModel} meta={meta}
        onEdit={onEdit} onExpand={onExpand}
      >
        {children}
      </BrewAgentCardBody>
    </div>
  );
}

export { modelShortName };
