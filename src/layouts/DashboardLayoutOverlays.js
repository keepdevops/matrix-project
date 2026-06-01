import React from 'react';
import SwarmConfig from '../components/SwarmConfig';
import ModelConverter from '../components/ModelConverter';
import HelpModal from '../components/HelpModal';
import RagAdmin from '../components/RagAdmin';
import CachePanel from '../components/CachePanel';
import PressureCluster from '../components/PressureCluster';
import DashboardStatTile from './DashboardStatTile';

export default function DashboardLayoutOverlays({
  online, activeMode, agentCount, responseCount, avgMs, kvPct, lastMeta,
  kvReadings, kvFetchFailed, excludedBreaker, error,
  showConverter, showConfigPanel, showHistory, showHelp, showRagAdmin, showCachePanel,
  recentHistory, onDeployed, onHistorySelect, onOpenHelp, onOpenRagAdmin, onOpenCachePanel,
}) {
  return (
    <>
      {/* ── Stats bar ── */}
      <div className="dl-stats-bar">
        <DashboardStatTile label="Status" value={online ? 'ONLINE' : 'OFFLINE'} accent={online} />
        <DashboardStatTile label="Mode"   value={activeMode || '—'} />
        <DashboardStatTile label="Agents" value={agentCount} sub={`${responseCount} responded`} />
        {avgMs !== null && <DashboardStatTile label="Avg latency" value={`${avgMs}ms`} />}
        {kvPct !== null && <DashboardStatTile label="KV usage" value={`${kvPct}%`} accent={kvPct > 80} />}
        {lastMeta?.wall_ms && <DashboardStatTile label="Wall time" value={`${Math.round(lastMeta.wall_ms)}ms`} />}
        <div className="dl-stats-pressure">
          <PressureCluster online={online} readings={kvReadings} fetchFailed={kvFetchFailed} />
        </div>
      </div>

      {/* ── Banners ── */}
      {excludedBreaker.length > 0 && (
        <div className="dispatch-hint-banner dispatch-hint-banner--breaker" role="status">
          Skipped (circuit breaker open): <strong>{excludedBreaker.join(', ')}</strong>
        </div>
      )}
      {error && (
        <div className="error-banner">
          {error.includes('Coordinator offline')
            ? 'Swarm not running — open CONFIGURE and click LAUNCH SWARM.'
            : `ERROR: ${error}`}
        </div>
      )}

      {/* ── Config / converter panels ── */}
      {showConverter && <div className="dl-panel-overlay"><ModelConverter standalone /></div>}
      {!showConverter && showConfigPanel && <SwarmConfig onDeployed={onDeployed} />}

      {showHistory && recentHistory.length > 0 && (
        <div className="history-dropdown">
          {recentHistory.map((entry, i) => (
            <div key={entry._run_id || entry.timestamp || i} className="history-item" onClick={() => onHistorySelect(entry)}>
              <span className="history-prompt">
                {entry.prompt?.substring(0, 50)}{entry.prompt?.length > 50 ? '…' : ''}
              </span>
              <span className="history-time">
                {entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : ''}
              </span>
            </div>
          ))}
        </div>
      )}

      {showHelp      && <HelpModal  onClose={onOpenHelp} />}
      {showRagAdmin  && <RagAdmin   onClose={onOpenRagAdmin} />}
      {showCachePanel && <CachePanel onClose={onOpenCachePanel} />}
    </>
  );
}
