import React from 'react';
import PressureCluster from '../components/PressureCluster';
import MlxMemoryBar from '../components/MlxMemoryBar';

function kvAggregate(readings) {
  if (!readings || readings.length === 0) return null;
  const valid = readings.filter(r => typeof r.usage === 'number');
  if (valid.length === 0) return null;
  const avgRatio = valid.reduce((s, r) => s + r.usage, 0) / valid.length;
  return { estGB: (avgRatio * 36 * 0.35).toFixed(1) };
}

export default function BrewMonitorStats({
  online, kvReadings, kvFetchFailed = false,
  activeAgents = [], engine = 'llama',
  excludedBreaker = [], cacheStatus = 'idle', onClearCache,
}) {
  const kv = kvAggregate(kvReadings);
  const kvStatus = online ? 'Active' : 'Inactive';
  const kvSize = kv ? `${kv.estGB} GB` : '—';
  const kvLabel = cacheStatus === 'clearing' ? 'Clearing…'
    : cacheStatus === 'cleared' ? '✓ Cleared'
    : cacheStatus === 'failed'  ? '✕ Failed'
    : 'Clear KV';

  return (
    <div className="brew-monitor-popout-body">
      <div className="brew-resource-section brew-resource-section--status">
        <div className="brew-monitor-status-row">
          <span className={`brew-monitor-status-dot${online ? ' online' : ''}`} />
          <span className="brew-monitor-status-label">{online ? 'ONLINE' : 'OFFLINE'}</span>
          {online && activeAgents.length > 0 && (
            <span className="brew-monitor-badge">
              {activeAgents.length} agent{activeAgents.length !== 1 ? 's' : ''}
            </span>
          )}
          <span className="brew-monitor-badge brew-monitor-badge--engine">{engine.toUpperCase()}</span>
        </div>
        {excludedBreaker.length > 0 && (
          <div className="brew-monitor-breaker">
            <span className="brew-monitor-breaker-icon">⚠</span>
            Circuit breaker: <strong>{excludedBreaker.join(', ')}</strong>
            <span className="brew-monitor-breaker-hint"> — ~30s</span>
          </div>
        )}
      </div>

      <div className="brew-resource-section">
        <div className="brew-res-kv-header">
          <span className="brew-res-kv-title">KV Cache</span>
          <span className={`brew-res-kv-dot${online ? ' online' : ''}`} />
        </div>
        <div className="brew-res-kv-row">
          <span className="brew-res-kv-stat">Status: <strong>{kvStatus}</strong></span>
          <span className="brew-res-kv-stat">Size: <strong>{kvSize}</strong></span>
        </div>
        {online && onClearCache && (
          <div className="brew-res-kv-actions">
            <button
              type="button"
              className={`brew-monitor-clear-btn brew-monitor-clear-btn--${cacheStatus}`}
              onClick={onClearCache}
              disabled={cacheStatus === 'clearing'}
            >
              {kvLabel}
            </button>
          </div>
        )}
      </div>

      <div className="brew-resource-section brew-resource-section--pressure brew-resource-section--last">
        {online && kvReadings && kvReadings.filter(r => r.backend !== 'mlx' && r.ok).length > 0 && (
          <div style={{ marginBottom: '0.4rem' }}>
            <div className="brew-res-layout-title" style={{ marginBottom: '0.2rem' }}>Llama Ports</div>
            {kvReadings.filter(r => r.backend !== 'mlx' && r.ok).map(r => (
              <div key={r.port} style={{ fontSize: '0.72rem', opacity: 0.8,
                                         display: 'flex', justifyContent: 'space-between',
                                         marginBottom: '0.1rem' }}>
                <span>:{r.port} <span style={{ opacity: 0.6 }}>{(r.names || []).join(', ')}</span></span>
                <span>{r.usage != null
                  ? `KV ${Math.round(r.usage * 100)}%`
                  : 'no data'}</span>
              </div>
            ))}
          </div>
        )}
        <MlxMemoryBar online={online} />
        <PressureCluster
          online={online}
          readings={kvReadings}
          fetchFailed={kvFetchFailed}
          poll={false}
        />
      </div>
    </div>
  );
}
