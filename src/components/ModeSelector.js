import React, { useEffect, useRef, useState } from 'react';

function ModeSelector({ modes, active, onChange, disabled }) {
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

  const handlePick = (name) => {
    setOpen(false);
    if (name && name !== active) onChange(name);
  };

  return (
    <div className="mode-selector" ref={rootRef}>
      <button
        className={`mode-button ${open ? 'active' : ''}`}
        onClick={() => setOpen(v => !v)}
        disabled={disabled || !hasModes}
        title="Coordinator orchestration mode"
      >
        MODE: {activeLabel.toUpperCase()} ▾
      </button>
      {open && hasModes && (
        <div className="mode-popover" role="menu" aria-label="Orchestration modes">
          {modes.map((m) => (
            <button
              key={m.name}
              className={`mode-option ${m.name === active ? 'selected' : ''}`}
              onClick={() => handlePick(m.name)}
              role="menuitem"
            >
              <div className="mode-option-name">{m.name}</div>
              {m.description && (
                <div className="mode-option-desc">{m.description}</div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default ModeSelector;
