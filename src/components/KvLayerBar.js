import React from 'react';

// Three-segment bar showing early/middle/recent KV entropy per port.
// entry.layer_profile: { early_entropy, middle_entropy, recent_entropy, eviction_priority }
export default function KvLayerBar({ profile }) {
  if (!profile) return null;

  const { early_entropy: e, middle_entropy: m, recent_entropy: r,
          eviction_priority: ep } = profile;

  const segStyle = (val, label) => ({
    flex: val || 0.1,
    height: 4,
    background: val >= 0.6 ? 'var(--color-success, #22c55e)'
               : val >= 0.3 ? 'var(--kv-warn, #ffae00)'
               :              'var(--text-dim, #444)',
    title: `${label}: ${val?.toFixed(2)}`,
  });

  return (
    <div title={`Layer entropy — early:${e?.toFixed(2)} mid:${m?.toFixed(2)} recent:${r?.toFixed(2)} evict:${ep?.toFixed(2)}`}
         style={{ display: 'flex', gap: 1, marginTop: 2, borderRadius: 2, overflow: 'hidden' }}>
      <div style={segStyle(e, 'early')} />
      <div style={segStyle(m, 'middle')} />
      <div style={segStyle(r, 'recent')} />
    </div>
  );
}
