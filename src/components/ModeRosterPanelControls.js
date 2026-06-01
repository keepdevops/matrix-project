import React from 'react';
import Button from './Button';

export function CircuitBreakerBanner({ tripped }) {
  if (!tripped.length) return null;
  return (
    <div style={{
      fontSize: '0.78rem', background: '#3a1010',
      border: '1px solid #ff4444', padding: '0.3rem 0.5rem',
      marginBottom: '0.5rem', borderRadius: '3px',
    }}>
      🔴 circuit breaker open: {tripped.map(t => `${t.name} (${t.cooldown_s}s)`).join(', ')}
      <span style={{ opacity: 0.7, marginLeft: '0.4rem' }}>
        — these agents are skipped on dispatch until cooldown elapses.
      </span>
    </div>
  );
}

export function ModeTabBar({ modes, activeTab, onSelect }) {
  return (
    <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '0.5rem' }}>
      {modes.map(m => (
        <Button
          key={m.name}
          variant="ghost"
          size="sm"
          className="swarm-deploy-btn"
          onClick={() => onSelect(m.name)}
          style={{
            opacity: activeTab === m.name ? 1 : 0.55,
            fontWeight: activeTab === m.name ? 700 : 400,
          }}
        >
          {m.name}{m.active ? ' ●' : ''}
        </Button>
      ))}
    </div>
  );
}

export function OverrideToggle({ explicit, available, busy, onEnable, onClear }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
      <button
        type="button"
        role="switch"
        aria-checked={explicit}
        className={`brew-perm-toggle${explicit ? ' on' : ''}`}
        onClick={() => explicit ? onClear() : onEnable()}
        disabled={busy}
        style={{ flexShrink: 0 }}
      >
        <span className="brew-perm-thumb" />
      </button>
      <span style={{ fontSize: '0.8rem', opacity: explicit ? 1 : 0.6 }}>
        {explicit
          ? `Override ON — custom roster active`
          : `Override OFF — using full roster (${available.length} agent${available.length === 1 ? '' : 's'})`}
      </span>
    </div>
  );
}

export function RosterFooter({ busy, error, staleAgents, savedAt, onSave }) {
  return (
    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem', alignItems: 'center' }}>
      <Button variant="outline-primary" size="sm" onClick={onSave} disabled={busy}>
        {busy ? 'Saving…' : 'Save'}
      </Button>
      {error && <span style={{ color: '#ff7777', fontSize: '0.8rem' }}>{error}</span>}
      {!error && staleAgents.length > 0 && (
        <span style={{ color: '#ffaa44', fontSize: '0.8rem' }}>
          ⚠ Not deployed: {staleAgents.join(', ')} — save to drop, or redeploy
        </span>
      )}
      {!error && !staleAgents.length && savedAt && (
        <span style={{ opacity: 0.7, fontSize: '0.8rem' }}>
          saved {new Date(savedAt).toLocaleTimeString()}
        </span>
      )}
    </div>
  );
}
