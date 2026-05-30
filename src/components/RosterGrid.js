import React from 'react';
import Button from './Button';

export default function RosterGrid({ selected, available, isPipeline, onAdd, onRemove, onMove }) {
  const inactive = isPipeline ? available : available.filter(n => !selected.includes(n));

  return (
    <div className="brew-roster-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
      <div>
        <div className="brew-roster-col-title">
          SELECTED {isPipeline && selected.length > 1 ? '(↑/↓ reorders pipeline)' : ''}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
          {selected.length === 0 && (
            <div className="brew-roster-empty">— none —</div>
          )}
          {selected.map((name, i) => (
            <div key={`${name}-${i}`} className="brew-roster-row">
              <span className="brew-roster-index">{i + 1}.</span>
              <span style={{ flex: 1 }}>{name}</span>
              {isPipeline && (
                <>
                  <Button variant="ghost" size="xs" onClick={() => onMove(i, -1)} disabled={i === 0}>↑</Button>
                  <Button variant="ghost" size="xs" onClick={() => onMove(i, +1)} disabled={i === selected.length - 1}>↓</Button>
                </>
              )}
              <Button variant="ghost" size="xs" onClick={() => onRemove(i)}>✕</Button>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="brew-roster-col-title">AVAILABLE</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
          {inactive.length === 0 && (
            <div className="brew-roster-empty">— all selected —</div>
          )}
          {inactive.map(name => (
            <Button key={name} variant="ghost" size="sm" onClick={() => onAdd(name)}>
              + {name}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
