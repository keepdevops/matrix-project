import React from 'react';

// Sparkline bar showing TES trend over last N responses.
// history: number[] of TES values (latest last). avg: mean.
export default function TesGauge({ history, avg }) {
  if (!history || history.length === 0) return null;
  const max = Math.max(...history, 0.001);

  return (
    <div className="tes-gauge" title={`TES avg: ${avg.toFixed(2)} tok/ms`}>
      <span className="tes-gauge-label">TES</span>
      <span className="tes-gauge-bars">
        {history.map((v, i) => (
          <span
            key={i}
            className="tes-gauge-bar"
            style={{ height: `${Math.round((v / max) * 16) + 2}px` }}
            title={v.toFixed(2)}
          />
        ))}
      </span>
      <span className="tes-gauge-avg">{avg.toFixed(2)}</span>
    </div>
  );
}
