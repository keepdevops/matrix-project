import React, { useEffect, useRef } from 'react';
import PressureCluster from '../components/PressureCluster';

function kvAggregate(readings) {
  if (!readings || readings.length === 0) return null;
  const valid = readings.filter(r => typeof r.kv_cache_usage_ratio === 'number');
  if (valid.length === 0) return null;
  const avgRatio = valid.reduce((s, r) => s + r.kv_cache_usage_ratio, 0) / valid.length;
  return { estGB: (avgRatio * 36 * 0.35).toFixed(1) };
}

export default function BrewMonitorPopout({
  open,
  onClose,
  online,
  kvReadings,
  activeAgents = [],
  engine = 'llama',
  excludedBreaker = [],
  cacheStatus = 'idle',
  onClearCache,
}) {
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (rootRef.current?.contains(e.target)) return;
      if (e.target.closest?.('.brew-monitor-trigger')) return;
      onClose?.();
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const kv = kvAggregate(kvReadings);
  const kvStatus = online ? 'Active' : 'Inactive';
  const kvSize = kv ? `${kv.estGB} GB` : '—';
  const kvLabel = cacheStatus === 'clearing' ? 'Clearing…'
    : cacheStatus === 'cleared' ? '✓ Cleared'
    : cacheStatus === 'failed'  ? '✕ Failed'
    : 'Clear KV';

  return (
    <div className="brew-monitor-popout" ref={rootRef} role="dialog" aria-label="KV monitor">
      <div className="brew-monitor-popout-header">
        <span className="brew-monitor-popout-title">Monitor</span>
        <button type="button" className="brew-monitor-popout-close" onClick={onClose} aria-label="Close monitor">✕</button>
      </div>

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

        {online && (
          <div className="brew-resource-section brew-resource-section--pressure brew-resource-section--last">
            <div className="brew-res-layout-title">Port Pressure</div>
            <PressureCluster online={online} />
          </div>
        )}
      </div>
    </div>
  );
}
