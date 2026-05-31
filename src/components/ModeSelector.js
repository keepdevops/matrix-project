import React, { useEffect, useRef, useState } from 'react';
import Button from './Button';

function ModeSelector({ modes, active, onChange, disabled, warningsByMode = {} }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const activeLabel = active || 'unknown';
  const hasModes = Array.isArray(modes) && modes.length > 0;
  const activeWarnings = warningsByMode[active] ?? [];

  const handlePick = (name) => {
    setOpen(false);
    if (name && name !== active) onChange(name);
  };

  return (
    <div className="mode-selector" ref={rootRef}>
      <Button
        variant="ghost"
        size="sm"
        className={`mode-button ${open ? 'active' : ''}`}
        onClick={() => setOpen(v => !v)}
        disabled={disabled || !hasModes}
        title={activeWarnings.length > 0 ? activeWarnings[0] : 'Coordinator orchestration mode'}
      >
        {activeWarnings.length > 0 && (
          <span style={{ marginRight: '0.3em', color: 'var(--color-warn)' }}>⚠</span>
        )}
        MODE: {activeLabel.toUpperCase()} ▾
      </Button>
      {open && hasModes && (
        <div className="mode-popover" role="menu" aria-label="Orchestration modes">
          {modes.map((m) => (
            <Button
              key={m.name}
              variant="ghost"
              size="sm"
              className={`mode-option ${m.name === active ? 'selected' : ''}`}
              onClick={() => handlePick(m.name)}
              role="menuitem"
            >
              <div className="mode-option-name">
                {(warningsByMode[m.name] ?? []).length > 0 && (
                  <span style={{ marginRight: '0.3em', color: 'var(--color-warn)' }} title={(warningsByMode[m.name] ?? [])[0]}>⚠</span>
                )}
                {m.name}
                {m.backend && m.backend !== 'cpp' && (
                  <span className="mode-option-backend" title={m.manifestNote || `${m.backend} backend`}>
                    {m.backend}
                  </span>
                )}
              </div>
              {m.description && (
                <div className="mode-option-desc">{m.description}</div>
              )}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

export default ModeSelector;
