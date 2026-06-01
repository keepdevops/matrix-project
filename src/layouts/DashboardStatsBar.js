import React, { useMemo } from 'react';
import PressureCluster from '../components/PressureCluster';
import DashboardStatTile from './DashboardStatTile';

export default function DashboardStatsBar({
  online, activeMode, activeAgents, responses, lastMeta, kvReadings, kvFetchFailed,
}) {
  const agentCount    = activeAgents.length;
  const responseCount = Object.keys(responses).length;
  const avgMs = useMemo(() => {
    if (!lastMeta?.timings) return null;
    const vals = Object.values(lastMeta.timings).map(t => t.total_ms).filter(Boolean);
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  }, [lastMeta]);
  const kvPct = useMemo(
    () => kvReadings?.length
      ? Math.round(kvReadings.reduce((s, r) => s + (r.usage ?? 0), 0) / kvReadings.length * 100)
      : null,
    [kvReadings]
  );

  return (
    <div className="dl-stats-bar">
      <DashboardStatTile
        label="Status"
        value={online ? 'ONLINE' : 'OFFLINE'}
        accent={online}
      />
      <DashboardStatTile label="Mode" value={activeMode || '—'} />
      <DashboardStatTile label="Agents" value={agentCount} sub={`${responseCount} responded`} />
      {avgMs !== null && <DashboardStatTile label="Avg latency" value={`${avgMs}ms`} />}
      {kvPct !== null && (
        <DashboardStatTile label="KV usage" value={`${kvPct}%`} accent={kvPct > 80} />
      )}
      {lastMeta?.wall_ms && (
        <DashboardStatTile label="Wall time" value={`${Math.round(lastMeta.wall_ms)}ms`} />
      )}
      <div className="dl-stats-pressure">
        <PressureCluster online={online} readings={kvReadings} fetchFailed={kvFetchFailed} />
      </div>
    </div>
  );
}
