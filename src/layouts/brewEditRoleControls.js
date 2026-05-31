import React from 'react';

export function BrewRoleToggle({ checked, onChange, id }) {
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

export function BrewRoleSliderRow({
  label, min, max, step, value, onChange, showToggle, toggleOn, onToggleChange,
}) {
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
        <BrewRoleToggle checked={toggleOn} onChange={onToggleChange} />
      ) : (
        <span className="brew-adv-value">{parseFloat(value).toFixed(step < 1 ? 2 : 0)}</span>
      )}
    </div>
  );
}

export const BREW_ROLE_CTX_OPTIONS = [0, 4096, 8192, 16384, 32768];
export const BREW_ROLE_TABS = ['Basic', 'Advanced'];
