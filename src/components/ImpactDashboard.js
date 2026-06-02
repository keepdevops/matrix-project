import React from 'react';
import Button from './Button';
import TesGauge from './TesGauge';
import { exportTrajectories } from '../api/trajectoryApi';
import { useImpactStats } from '../hooks/useImpactStats';
import { useTesHistory } from '../hooks/useTesHistory';

function StatRow({ label, value, pct }) {
  const color = pct >= 0.7 ? 'var(--color-success, #22c55e)'
              : pct >= 0.4 ? 'var(--kv-warn, #ffae00)'
              :              'var(--text-dim, #555)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem',
                  marginBottom: '0.2rem', fontSize: '0.75rem' }}>
      <span style={{ width: '7rem', opacity: 0.65 }}>{label}</span>
      <div style={{ flex: 1, height: 4, background: 'var(--bg-secondary, #111)',
                    borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${Math.round(pct * 100)}%`,
                      background: color }} />
      </div>
      <span style={{ width: '3rem', textAlign: 'right', color }}>{value}</span>
    </div>
  );
}

export default function ImpactDashboard({ sessionId, online }) {
  const stats = useImpactStats({ sessionId, online });
  const { history: tesHistory, avg: tesAvg } = useTesHistory();

  if (!stats) {
    return (
      <div style={{ padding: '0.5rem', opacity: 0.5, fontSize: '0.78rem' }}>
        {online ? 'Loading…' : 'Offline'}
      </div>
    );
  }

  return (
    <div style={{ padding: '0.5rem', fontSize: '0.78rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between',
                    alignItems: 'center', marginBottom: '0.5rem' }}>
        <span style={{ fontWeight: 600 }}>IMPACT DASHBOARD</span>
        <span style={{ opacity: 0.5 }}>{stats.count} trajectories</span>
      </div>

      <TesGauge history={tesHistory} avg={tesAvg} />

      <div style={{ marginTop: '0.4rem' }}>
        <StatRow label="Avg TES"        value={stats.avgTes.toFixed(2)}   pct={stats.avgTes} />
        <StatRow label="Avg Importance" value={stats.avgImp.toFixed(2)}   pct={stats.avgImp} />
        <StatRow label="RAG Hit Rate"   value={`${Math.round(stats.avgRag * 100)}%`} pct={stats.avgRag} />
      </div>

      <Button variant="outline-primary" size="sm"
              onClick={() => exportTrajectories(sessionId)}
              disabled={stats.count === 0}
              style={{ marginTop: '0.5rem', width: '100%' }}>
        ↓ Export Dataset (.jsonl)
      </Button>
    </div>
  );
}
