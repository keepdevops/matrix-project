import React, { useEffect, useRef } from 'react';
import BrewMonitorStats from './BrewMonitorStats';
// Body: Port Pressure via PressureCluster — impl in BrewMonitorStats.js

export default function BrewMonitorPopout({
  open,
  onClose,
  online,
  kvReadings,
  kvFetchFailed = false,
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

  return (
    <div className="brew-monitor-popout" ref={rootRef} role="dialog" aria-label="KV monitor">
      <div className="brew-monitor-popout-header">
        <span className="brew-monitor-popout-title">Monitor</span>
        <button type="button" className="brew-monitor-popout-close" onClick={onClose} aria-label="Close monitor">✕</button>
      </div>
      <BrewMonitorStats
        online={online}
        kvReadings={kvReadings}
        kvFetchFailed={kvFetchFailed}
        activeAgents={activeAgents}
        engine={engine}
        excludedBreaker={excludedBreaker}
        cacheStatus={cacheStatus}
        onClearCache={onClearCache}
      />
    </div>
  );
}
