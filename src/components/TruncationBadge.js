import React from 'react';

// Shows TRUNC badge when meta.truncation indicates any agent input was truncated.
export default function TruncationBadge({ truncation }) {
  if (!truncation) return null;
  const truncated = Object.entries(truncation || {}).filter(([, v]) => v?.truncated);
  if (truncated.length === 0) return null;

  const tip = truncated.map(([name, v]) =>
    `${name}: ${v.original_chars}→${v.truncated_chars} chars`
  ).join(', ');

  return (
    <span title={`Input truncated: ${tip}`}
          style={{ marginLeft: '0.4rem', opacity: 0.85, fontSize: '0.72rem',
                   background: 'var(--kv-warn, #ffae00)', color: '#000',
                   padding: '0 0.3rem', borderRadius: 3, lineHeight: 1.4 }}>
      TRUNC {truncated.length}
    </span>
  );
}
