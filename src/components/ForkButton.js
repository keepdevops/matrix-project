import React, { useState } from 'react';
import { forkSession } from '../api/historyApi';

export default function ForkButton({ runId, onForked, style }) {
  const [state, setState] = useState('idle'); // idle | working | done | err

  if (!runId) return null;

  const handleClick = async (e) => {
    e.stopPropagation();
    setState('working');
    try {
      const result = await forkSession(runId);
      setState('done');
      setTimeout(() => setState('idle'), 1500);
      onForked?.(result);
    } catch (err) {
      console.error('[ForkButton] fork failed:', err);
      setState('err');
      setTimeout(() => setState('idle'), 2000);
    }
  };

  const label = state === 'working' ? '…'
              : state === 'done'    ? '✓'
              : state === 'err'     ? '✗'
              :                       '⑂';

  return (
    <button
      onClick={handleClick}
      disabled={state === 'working'}
      title="Fork into new session"
      style={{
        fontSize: '0.72rem', padding: '0 0.3rem', cursor: 'pointer',
        background: 'none', border: '1px solid currentColor',
        borderRadius: 3, opacity: state === 'done' ? 1 : 0.65,
        color: state === 'err' ? 'var(--color-danger, #ef4444)'
             : state === 'done' ? 'var(--color-success, #22c55e)'
             : undefined,
        lineHeight: 1.4,
        ...style,
      }}>
      {label}
    </button>
  );
}
