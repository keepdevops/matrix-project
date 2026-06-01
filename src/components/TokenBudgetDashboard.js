import React from 'react';
import { resetTokenBudget } from '../api/tokenBudgetApi';

function pct(consumed, budget) {
  if (!budget) return 0;
  return Math.min(100, Math.round((consumed / budget) * 100));
}

function shortId(id) {
  if (!id) return '—';
  return id.length > 16 ? id.slice(0, 8) + '…' + id.slice(-6) : id;
}

export default function TokenBudgetDashboard({ sessions, onReset }) {
  if (!sessions || sessions.length === 0) {
    return (
      <div className="tbd-empty" style={{ padding: '0.5rem', opacity: 0.5, fontSize: '0.78rem' }}>
        No active sessions
      </div>
    );
  }

  const handleReset = async (sessionId) => {
    try {
      await resetTokenBudget(sessionId);
      onReset?.(sessionId);
    } catch (err) {
      console.error('[TokenBudgetDashboard] reset failed:', err);
    }
  };

  return (
    <div className="tbd" style={{ fontSize: '0.75rem' }}>
      <div className="tbd-header" style={{
        display: 'grid', gridTemplateColumns: '1fr 4rem 4rem 4rem 2.5rem 2rem',
        columnGap: '0.4rem', opacity: 0.55, marginBottom: '0.2rem',
      }}>
        <span>session</span><span>budget</span><span>used</span>
        <span>left</span><span>%</span><span />
      </div>
      {sessions.map(s => {
        const p = pct(s.consumed, s.budget);
        return (
          <div key={s.session_id} className="tbd-row" style={{
            display: 'grid', gridTemplateColumns: '1fr 4rem 4rem 4rem 2.5rem 2rem',
            columnGap: '0.4rem', alignItems: 'center', marginBottom: '0.15rem',
            color: s.overrun ? 'var(--color-danger, #ef4444)' : undefined,
          }}>
            <span title={s.session_id} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {shortId(s.session_id)}
              {s.overrun && <span style={{ marginLeft: '0.25rem', fontWeight: 600 }}>!</span>}
            </span>
            <span>{s.budget > 0 ? s.budget.toLocaleString() : '∞'}</span>
            <span>{s.consumed.toLocaleString()}</span>
            <span>{s.remaining >= 0 ? s.remaining.toLocaleString() : '∞'}</span>
            <span>{s.budget > 0 ? `${p}%` : '—'}</span>
            <button onClick={() => handleReset(s.session_id)}
                    title="Reset session budget"
                    style={{ fontSize: '0.68rem', padding: '0 0.2rem', cursor: 'pointer',
                             background: 'none', border: '1px solid currentColor',
                             borderRadius: 3, opacity: 0.7, lineHeight: 1.4 }}>
              ↺
            </button>
          </div>
        );
      })}
    </div>
  );
}
