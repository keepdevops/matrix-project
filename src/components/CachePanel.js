import React, { useState, useEffect, useCallback } from 'react';
import { fetchCacheStats, clearCache } from '../api/swarmApi';
import Button from './Button';
import CachePanelConfig from './CachePanelConfig';

function StatRow({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', padding: '0.1rem 0' }}>
      <span style={{ opacity: 0.7 }}>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export default function CachePanel({ onClose }) {
  const [stats, setStats]       = useState(null);
  const [loadErr, setLoadErr]   = useState('');
  const [clearBusy, setClearBusy] = useState(false);
  const [clearMsg, setClearMsg]   = useState('');

  const load = useCallback(async () => {
    setLoadErr('');
    try {
      setStats(await fetchCacheStats());
    } catch (e) {
      console.error('[CachePanel] load failed:', e);
      setLoadErr(e.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleClear = async () => {
    setClearBusy(true);
    setClearMsg('');
    try {
      setStats(await clearCache());
      setClearMsg('Cache cleared.');
      setTimeout(() => setClearMsg(''), 3000);
    } catch (e) {
      console.error('[CachePanel] clear failed:', e);
      setClearMsg(`Error: ${e.message}`);
    } finally {
      setClearBusy(false);
    }
  };

  const overlay = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
  };
  const modal = {
    background: 'var(--bg-secondary, #1e1e1e)', border: '1px solid rgba(128,128,128,0.4)',
    borderRadius: 6, padding: '1.25rem', width: 340, maxWidth: '92vw',
    color: 'var(--text-primary, #e0e0e0)',
  };

  return (
    <div style={overlay} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={modal}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
          <strong style={{ fontSize: '0.9rem', letterSpacing: '0.05em' }}>RESPONSE CACHE</strong>
          <Button variant="ghost" size="xs" onClick={onClose} style={{ opacity: 0.6 }}>✕</Button>
        </div>

        {loadErr && (
          <div style={{ color: 'var(--brew-kv-crit, #e55)', fontSize: '0.8rem', marginBottom: '0.5rem' }}>
            {loadErr} <Button variant="ghost" size="xs" onClick={load} style={{ marginLeft: '0.4rem' }}>retry</Button>
          </div>
        )}

        {stats && (
          <div style={{ marginBottom: '0.85rem', padding: '0.5rem 0.6rem', background: 'rgba(128,128,128,0.08)', borderRadius: 4 }}>
            <StatRow label="enabled"    value={stats.enabled ? 'yes' : 'no'} />
            <StatRow label="size / max" value={`${stats.size} / ${stats.max_entries}`} />
            <StatRow label="ttl"        value={`${stats.ttl_secs}s`} />
            <StatRow label="hits"       value={stats.hits} />
            <StatRow label="misses"     value={stats.misses} />
            <StatRow label="inserts"    value={stats.inserts} />
            <StatRow label="evictions"  value={stats.evictions} />
          </div>
        )}

        <CachePanelConfig stats={stats} onStatsUpdate={setStats} />

        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', borderTop: '1px solid rgba(128,128,128,0.2)', paddingTop: '0.65rem' }}>
          <Button variant="primary" size="sm" onClick={handleClear} disabled={clearBusy}>
            {clearBusy ? 'Clearing…' : 'Clear KV'}
          </Button>
          <Button variant="ghost" size="sm" onClick={load}>Refresh</Button>
          {clearMsg && (
            <span style={{ fontSize: '0.78rem', color: clearMsg.startsWith('Error') ? 'var(--brew-kv-crit, #e55)' : '#9ec99e' }}>
              {clearMsg}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
