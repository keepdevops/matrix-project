import React from 'react';

export default function RosterGrid({ selected, available, isPipeline, onAdd, onRemove, onMove }) {
  const inactive = isPipeline ? available : available.filter(n => !selected.includes(n));

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
      <div>
        <div style={{ fontSize: '0.75rem', opacity: 0.7, marginBottom: '0.25rem' }}>
          SELECTED {isPipeline && selected.length > 1 ? '(↑/↓ reorders pipeline)' : ''}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
          {selected.length === 0 && (
            <div style={{ opacity: 0.5, fontSize: '0.8rem' }}>— none —</div>
          )}
          {selected.map((name, i) => (
            <div key={`${name}-${i}`}
                 style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <span style={{ fontSize: '0.7rem', opacity: 0.6, width: '1.2rem' }}>{i + 1}.</span>
              <span style={{ flex: 1, fontSize: '0.85rem' }}>{name}</span>
              {isPipeline && (
                <>
                  <button onClick={() => onMove(i, -1)} disabled={i === 0}
                          style={{ padding: '0 0.3rem' }}>↑</button>
                  <button onClick={() => onMove(i, +1)} disabled={i === selected.length - 1}
                          style={{ padding: '0 0.3rem' }}>↓</button>
                </>
              )}
              <button onClick={() => onRemove(i)} style={{ padding: '0 0.3rem' }}>✕</button>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div style={{ fontSize: '0.75rem', opacity: 0.7, marginBottom: '0.25rem' }}>AVAILABLE</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
          {inactive.length === 0 && (
            <div style={{ opacity: 0.5, fontSize: '0.8rem' }}>— all selected —</div>
          )}
          {inactive.map(name => (
            <button key={name} onClick={() => onAdd(name)}
                    style={{ textAlign: 'left', padding: '0.2rem 0.4rem', fontSize: '0.85rem' }}>
              + {name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
