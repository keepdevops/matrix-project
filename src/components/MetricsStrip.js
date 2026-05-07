import React from 'react';

// Renders the per-agent timings + token counts surfaced in `envelope.meta`.
// Drop in next to any AgentResponse rendering — accepts the full envelope
// and pulls `meta.timings` + `meta.wall_ms`. No-op if the envelope lacks them.
//
// Shape of meta.timings:
//   { agent_name: { calls, total_ms, avg_ms?, completion_tokens, prompt_tokens? } }
export default function MetricsStrip({ envelope }) {
  const meta = envelope?.meta || {};
  const timings = meta.timings;
  const wallMs = meta.wall_ms;
  if (!timings || typeof timings !== 'object' || Object.keys(timings).length === 0) {
    return null;
  }

  const rows = Object.entries(timings)
    .map(([name, m]) => ({ name, ...m }))
    .sort((a, b) => (b.total_ms || 0) - (a.total_ms || 0));

  const totalAgentMs = rows.reduce((s, r) => s + (r.total_ms || 0), 0);
  const totalTokens  = rows.reduce((s, r) => s + (r.completion_tokens || 0), 0);

  return (
    <div style={{
      fontSize: '0.78rem',
      padding: '0.4rem 0.6rem',
      background: '#0c0c0c',
      border: '1px solid #2a2a2a',
      borderRadius: '4px',
      marginTop: '0.5rem',
    }}>
      <div style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
        marginBottom: '0.25rem',
      }}>
        <span style={{ opacity: 0.7 }}>RUN METRICS</span>
        <span style={{ opacity: 0.55 }}>
          {wallMs != null && `wall ${(wallMs / 1000).toFixed(2)}s · `}
          agent ms {(totalAgentMs / 1000).toFixed(2)}s · {totalTokens} tok
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
        {rows.map(r => {
          const pct = totalAgentMs > 0 ? (r.total_ms / totalAgentMs) * 100 : 0;
          return (
            <div key={r.name}
                 style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <span style={{ width: '7rem', opacity: 0.85 }}>{r.name}</span>
              <span style={{ width: '4.5rem', textAlign: 'right', opacity: 0.75 }}>
                {(r.total_ms / 1000).toFixed(2)}s
              </span>
              <span style={{ width: '4.5rem', textAlign: 'right', opacity: 0.75 }}>
                {r.completion_tokens || 0} tok
              </span>
              <div style={{
                flex: 1, height: '0.5rem', background: '#1a1a1a',
                borderRadius: '2px', overflow: 'hidden',
              }}>
                <div style={{
                  width: `${pct.toFixed(1)}%`,
                  height: '100%',
                  background: '#3a82ff',
                }} />
              </div>
              <span style={{ width: '3rem', textAlign: 'right',
                             opacity: 0.55, fontSize: '0.7rem' }}>
                {pct.toFixed(0)}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
