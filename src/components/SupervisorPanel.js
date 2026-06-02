import React from 'react';
import Button from './Button';
import { useSupervisorAudit } from '../hooks/useSupervisorAudit';

const ACTION_STYLE = {
  prune:       { background: 'var(--color-danger, #ef4444)', color: '#fff' },
  deprioritize:{ background: 'var(--kv-warn, #ffae00)',      color: '#000' },
  hint:        { background: 'var(--color-primary, #4a9eff)', color: '#fff' },
  ok:          { background: 'var(--color-success, #22c55e)', color: '#fff' },
};

function ActionBadge({ action }) {
  const style = ACTION_STYLE[action] || ACTION_STYLE.ok;
  return (
    <span style={{ ...style, fontSize: '0.68rem', padding: '0 0.3rem',
                   borderRadius: 3, fontWeight: 600, lineHeight: 1.4 }}>
      {action.toUpperCase()}
    </span>
  );
}

export default function SupervisorPanel({ online }) {
  const { entries, clear } = useSupervisorAudit({ online });

  return (
    <div style={{ padding: '0.5rem', fontSize: '0.75rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between',
                    alignItems: 'center', marginBottom: '0.4rem' }}>
        <span style={{ fontWeight: 600 }}>SUPERVISOR AUDIT</span>
        {entries.length > 0 && (
          <Button variant="ghost" size="xs" onClick={clear}>Clear</Button>
        )}
      </div>

      {entries.length === 0 && (
        <div style={{ opacity: 0.5 }}>No interventions recorded</div>
      )}

      {entries.slice().reverse().map((e, i) => (
        <div key={i} style={{ marginBottom: '0.5rem', padding: '0.3rem 0.4rem',
                              background: 'var(--bg-secondary, #111)', borderRadius: 3 }}>
          <div style={{ opacity: 0.5, fontSize: '0.68rem', marginBottom: '0.2rem' }}>
            {new Date(e.timestamp_ms).toLocaleTimeString()} ·
            KV {Math.round(e.kv_pressure * 100)}%
          </div>
          {(e.decisions || []).map((d, j) => (
            <div key={j} style={{ display: 'flex', alignItems: 'center',
                                   gap: '0.4rem', marginBottom: '0.15rem' }}>
              <ActionBadge action={d.action} />
              <span style={{ fontWeight: 500 }}>{d.agent}</span>
              <span style={{ opacity: 0.6, flex: 1 }}>{d.reason}</span>
              <span style={{ opacity: 0.5 }}>{Math.round(d.confidence * 100)}%</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
