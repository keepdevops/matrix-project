import React from 'react';

export default function BrewConfigUnavailable({ onRetry }) {
  return (
    <div className="layout-brewlate">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: '1rem', color: 'var(--brew-text-muted)' }}>
        <div style={{ fontSize: '0.85rem', color: 'var(--brew-accent)' }}>CONFIG UNAVAILABLE</div>
        <div style={{ fontSize: '0.72rem' }}>Start the proxy then retry.</div>
        <button
          type="button"
          onClick={onRetry}
          style={{ padding: '0.5rem 1rem', background: 'var(--brew-border)', border: 'none', borderRadius: 4, color: 'var(--brew-text)', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.72rem' }}
        >RETRY</button>
      </div>
    </div>
  );
}
