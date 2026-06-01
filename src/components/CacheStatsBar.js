import React from 'react';

export default function CacheStatsBar({ stats }) {
  if (!stats || (!stats.enabled && stats.hits === 0 && stats.misses === 0)) return null;

  const pct = Math.round(stats.hit_rate * 100);
  const color = pct >= 70 ? 'var(--color-success, #22c55e)'
              : pct >= 40 ? 'var(--kv-warn, #ffae00)'
              :              'var(--text-dim, #666)';

  return (
    <div className="cache-stats-bar"
         style={{ fontSize: '0.72rem', opacity: 0.8, padding: '0.2rem 0.4rem' }}
         title={`Cache: ${stats.hits} hits, ${stats.misses} misses, ${stats.evictions} evictions`}>
      <span style={{ marginRight: '0.3rem' }}>CACHE</span>
      <span style={{ color, fontWeight: 600 }}>{pct}% hit</span>
      <span style={{ marginLeft: '0.4rem', opacity: 0.7 }}>
        · {stats.size} entries · {stats.evictions} evicted
      </span>
    </div>
  );
}
