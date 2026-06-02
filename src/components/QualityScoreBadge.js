import React from 'react';

// Renders quality_score as a colour-coded 0.00–1.00 badge.
export default function QualityScoreBadge({ score }) {
  if (score == null || score < 0) return null;

  const color = score >= 0.7 ? 'var(--color-success, #22c55e)'
              : score >= 0.4 ? 'var(--kv-warn, #ffae00)'
              :                'var(--text-dim, #666)';

  return (
    <span title={`Trajectory quality score: ${score.toFixed(3)}`}
          style={{ fontSize: '0.7rem', padding: '0 0.25rem', borderRadius: 3,
                   border: `1px solid ${color}`, color, lineHeight: 1.4 }}>
      Q {score.toFixed(2)}
    </span>
  );
}
