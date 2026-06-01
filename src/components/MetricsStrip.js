import React from 'react';

// Renders the per-agent timings + token counts surfaced in `envelope.meta`.
// Drop in next to any AgentResponse rendering — accepts the full envelope
// and pulls `meta.timings` + `meta.wall_ms`. No-op if the envelope lacks them.
//
// Styling is class-based (.metrics-strip*) so it picks up light/dark theme
// rules from src/themes/light.css without needing inline branching.
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
    <div className="metrics-strip">
      <div className="metrics-strip-header">
        <span className="metrics-strip-title">RUN METRICS</span>
        <span className="metrics-strip-totals">
          {wallMs != null && `wall ${(wallMs / 1000).toFixed(2)}s · `}
          agent ms {(totalAgentMs / 1000).toFixed(2)}s · {totalTokens} tok
          {meta.context_gate?.triggered && (
            <span title={`Prompt compressed: ${meta.context_gate.original_chars} → ${meta.context_gate.summary_chars} chars`}
                  style={{ marginLeft: '0.4rem', opacity: 0.8, fontSize: '0.72rem',
                           background: 'var(--color-primary, #4a9eff)', color: '#fff',
                           padding: '0 0.3rem', borderRadius: 3 }}>
              CTX
            </span>
          )}
          {meta.auto_clear_kv && (
            <span title="KV cache auto-cleared (high pressure + topic switch)"
                  style={{ marginLeft: '0.3rem', opacity: 0.8, fontSize: '0.72rem',
                           background: 'var(--kv-warn, #ffae00)', color: '#000',
                           padding: '0 0.3rem', borderRadius: 3 }}>
              KV↺
            </span>
          )}
        </span>
      </div>
      <div className="metrics-strip-rows">
        {rows.map(r => {
          const pct = totalAgentMs > 0 ? (r.total_ms / totalAgentMs) * 100 : 0;
          return (
            <div key={r.name} className="metrics-strip-row">
              <span className="metrics-strip-name">{r.name}</span>
              <span className="metrics-strip-ms">
                {((r.total_ms || 0) / 1000).toFixed(2)}s
              </span>
              <span className="metrics-strip-tokens">
                {r.completion_tokens || 0} tok
              </span>
              <div className="metrics-strip-bar">
                <div className="metrics-strip-bar-fill"
                     style={{ width: `${pct.toFixed(1)}%` }} />
              </div>
              <span className="metrics-strip-pct">{pct.toFixed(0)}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
