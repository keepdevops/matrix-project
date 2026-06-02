import React from 'react';
import { exportSessionMd, exportSessionJson } from '../api/sessionApi';

export default function SessionExportButtons({ sessionId, style }) {
  if (!sessionId) return null;

  const btnStyle = {
    fontSize: '0.72rem', padding: '0.1rem 0.35rem', cursor: 'pointer',
    background: 'none', border: '1px solid currentColor',
    borderRadius: 3, opacity: 0.7, lineHeight: 1.4,
  };

  return (
    <span style={{ display: 'inline-flex', gap: '0.3rem', ...style }}>
      <button style={btnStyle} title="Download session as Markdown"
              onClick={() => exportSessionMd(sessionId)}>
        ↓ MD
      </button>
      <button style={btnStyle} title="Download session as JSON"
              onClick={() => exportSessionJson(sessionId)}>
        ↓ JSON
      </button>
    </span>
  );
}
