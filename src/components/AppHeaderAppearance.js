import React, { useState, useMemo } from 'react';
import { LAYOUTS, THEMES } from '../layouts/registry';
import Button from './Button';

export default function AppHeaderAppearance({ theme, layout, onSetTheme, onSetLayout }) {
  const [showAppearance, setShowAppearance] = useState(false);
  const themeEntries = useMemo(() => Object.entries(THEMES), []);
  const layoutEntries = useMemo(() => Object.entries(LAYOUTS), []);

  return (
    <div className="appearance-picker" style={{ position: 'relative', display: 'inline-block' }}>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setShowAppearance(v => !v)}
        aria-label="Layout and theme"
        title="Pick layout and theme"
      >
        {THEMES[theme]?.label ?? '☾ Dark'}
      </Button>
      {showAppearance && (
        <div className="appearance-dropdown" style={{
          position: 'absolute', right: 0, top: '100%', zIndex: 200,
          background: 'var(--panel-bg, #161b22)', border: '1px solid var(--panel-border, #30363d)',
          borderRadius: 6, padding: '0.5rem', minWidth: 160,
        }}>
          <div style={{ fontSize: '0.7rem', opacity: 0.6, marginBottom: '0.4rem', textTransform: 'uppercase' }}>Layout</div>
          {layoutEntries.map(([id, { label }]) => (
            <Button
              key={id}
              variant="ghost"
              size="sm"
              className={`appearance-option${layout === id ? ' active' : ''}`}
              style={{ display: 'block', width: '100%', textAlign: 'left', fontWeight: layout === id ? 700 : 400 }}
              onClick={() => { onSetLayout?.(id); setShowAppearance(false); }}
            >
              {label}
            </Button>
          ))}
          <div style={{ fontSize: '0.7rem', opacity: 0.6, margin: '0.4rem 0', textTransform: 'uppercase' }}>Theme</div>
          {themeEntries.map(([id, { label }]) => (
            <Button
              key={id}
              variant="ghost"
              size="sm"
              className={`appearance-option${theme === id ? ' active' : ''}`}
              style={{ display: 'block', width: '100%', textAlign: 'left', fontWeight: theme === id ? 700 : 400 }}
              onClick={() => { onSetTheme(id); setShowAppearance(false); }}
            >
              {label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
