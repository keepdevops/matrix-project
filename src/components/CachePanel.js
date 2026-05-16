import React, { useState, useEffect, useCallback } from 'react';
import { fetchCacheStats, clearCache, setCacheConfig } from '../api/swarmApi';

function StatRow({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', padding: '0.1rem 0' }}>
      <span style={{ opacity: 0.7 }}>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export default function CachePanel({ onClose }) {
  const [stats, setStats] = useState(null);
  const [loadErr, setLoadErr] = useState('');
  const [clearBusy, setClearBusy] = useState(false);
  const [clearMsg, setClearMsg] = useState('');
  const [cfgBusy, setCfgBusy] = useState(false);
  const [cfgMsg, setCfgMsg] = useState('');

  // Draft config
  const [draftEnabled, setDraftEnabled] = useState(true);
  const [draftTtl, setDraftTtl] = useState('');
  const [draftMax, setDraftMax] = useState('');

  const load = useCallback(async () => {
    setLoadErr('');
    try {
      const s = await fetchCacheStats();
      setStats(s);
      setDraftEnabled(s.enabled);
      if (draftTtl === '') setDraftTtl(String(s.ttl_secs ?? ''));
      if (draftMax === '') setDraftMax(String(s.max_entries ?? ''));
    } catch (e) {
      console.error('[CachePanel] load failed:', e);
      setLoadErr(e.message);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleClear = async () => {
    setClearBusy(true);
    setClearMsg('');
    try {
      const s = await clearCache();
      setStats(s);
      setClearMsg('Cache cleared.');
      setTimeout(() => setClearMsg(''), 3000);
    } catch (e) {
      console.error('[CachePanel] clear failed:', e);
      setClearMsg(`Error: ${e.message}`);
    } finally {
      setClearBusy(false);
    }
  };

  const handleSaveConfig = async () => {
    setCfgBusy(true);
    setCfgMsg('');
    try {
      const ttl = draftTtl !== '' ? parseInt(draftTtl, 10) : undefined;
      const maxE = draftMax !== '' ? parseInt(draftMax, 10) : undefined;
      const s = await setCacheConfig({
        enabled: draftEnabled,
        ttl_secs: Number.isFinite(ttl) && ttl > 0 ? ttl : undefined,
        max_entries: Number.isFinite(maxE) && maxE > 0 ? maxE : undefined,
      });
      setStats(s);
      setCfgMsg('Saved.');
      setTimeout(() => setCfgMsg(''), 3000);
    } catch (e) {
      console.error('[CachePanel] config failed:', e);
      setCfgMsg(`Error: ${e.message}`);
    } finally {
      setCfgBusy(false);
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
  const inputStyle = {
    padding: '0.2rem 0.35rem', fontSize: '0.82rem',
    background: 'var(--bg-primary, #111)', color: 'inherit',
    border: '1px solid rgba(128,128,128,0.4)', borderRadius: 3, width: '100%',
  };

  return (
    <div style={overlay} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={modal}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
          <strong style={{ fontSize: '0.9rem', letterSpacing: '0.05em' }}>RESPONSE CACHE</strong>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', color: 'inherit', opacity: 0.6 }}>✕</button>
        </div>

        {loadErr && (
          <div style={{ color: '#ff8888', fontSize: '0.8rem', marginBottom: '0.5rem' }}>
            {loadErr} <button onClick={load} style={{ marginLeft: '0.4rem', fontSize: '0.78rem' }}>retry</button>
          </div>
        )}

        {stats && (
          <div style={{ marginBottom: '0.85rem', padding: '0.5rem 0.6rem', background: 'rgba(128,128,128,0.08)', borderRadius: 4 }}>
            <StatRow label="enabled" value={stats.enabled ? 'yes' : 'no'} />
            <StatRow label="size / max" value={`${stats.size} / ${stats.max_entries}`} />
            <StatRow label="ttl" value={`${stats.ttl_secs}s`} />
            <StatRow label="hits" value={stats.hits} />
            <StatRow label="misses" value={stats.misses} />
            <StatRow label="inserts" value={stats.inserts} />
            <StatRow label="evictions" value={stats.evictions} />
          </div>
        )}

        <div style={{ marginBottom: '0.75rem' }}>
          <div style={{ fontSize: '0.78rem', opacity: 0.6, marginBottom: '0.4rem', letterSpacing: '0.04em' }}>CONFIG</div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem', marginBottom: '0.35rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={draftEnabled} onChange={e => setDraftEnabled(e.target.checked)} />
            enabled
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem', marginBottom: '0.45rem' }}>
            <div>
              <div style={{ fontSize: '0.74rem', opacity: 0.6, marginBottom: '0.15rem' }}>ttl (secs)</div>
              <input type="number" min={1} style={inputStyle} value={draftTtl}
                onChange={e => setDraftTtl(e.target.value)} placeholder="unchanged" />
            </div>
            <div>
              <div style={{ fontSize: '0.74rem', opacity: 0.6, marginBottom: '0.15rem' }}>max entries</div>
              <input type="number" min={1} style={inputStyle} value={draftMax}
                onChange={e => setDraftMax(e.target.value)} placeholder="unchanged" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button onClick={handleSaveConfig} disabled={cfgBusy} className="swarm-deploy-btn" style={{ padding: '0.2rem 0.6rem', fontSize: '0.8rem' }}>
              {cfgBusy ? 'Saving…' : 'Save config'}
            </button>
            {cfgMsg && <span style={{ fontSize: '0.78rem', color: cfgMsg.startsWith('Error') ? '#ff8888' : '#9ec99e' }}>{cfgMsg}</span>}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', borderTop: '1px solid rgba(128,128,128,0.2)', paddingTop: '0.65rem' }}>
          <button onClick={handleClear} disabled={clearBusy} className="swarm-deploy-btn" style={{ padding: '0.2rem 0.6rem', fontSize: '0.8rem' }}>
            {clearBusy ? 'Clearing…' : 'Clear KV'}
          </button>
          <button onClick={load} style={{ padding: '0.2rem 0.5rem', fontSize: '0.78rem' }}>
            Refresh
          </button>
          {clearMsg && <span style={{ fontSize: '0.78rem', color: clearMsg.startsWith('Error') ? '#ff8888' : '#9ec99e' }}>{clearMsg}</span>}
        </div>
      </div>
    </div>
  );
}
