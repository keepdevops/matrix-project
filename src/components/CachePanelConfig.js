import React, { useState, useEffect, useRef } from 'react';
import { setCacheConfig } from '../api/swarmApi';
import Button from './Button';

const inputStyle = {
  padding: '0.2rem 0.35rem', fontSize: '0.82rem',
  background: 'var(--bg-primary, #111)', color: 'inherit',
  border: '1px solid rgba(128,128,128,0.4)', borderRadius: 3, width: '100%',
};

/** Config form (enable toggle, ttl, max entries, save button) for CachePanel. */
export default function CachePanelConfig({ stats, onStatsUpdate }) {
  const [cfgBusy, setCfgBusy] = useState(false);
  const [cfgMsg, setCfgMsg]   = useState('');
  const [draftEnabled, setDraftEnabled] = useState(true);
  const [draftTtl, setDraftTtl] = useState('');
  const [draftMax, setDraftMax] = useState('');
  const draftTtlRef = useRef(draftTtl);
  const draftMaxRef = useRef(draftMax);
  useEffect(() => { draftTtlRef.current = draftTtl; }, [draftTtl]);
  useEffect(() => { draftMaxRef.current = draftMax; }, [draftMax]);

  useEffect(() => {
    if (!stats) return;
    setDraftEnabled(stats.enabled);
    if (draftTtlRef.current === '') setDraftTtl(String(stats.ttl_secs ?? ''));
    if (draftMaxRef.current === '') setDraftMax(String(stats.max_entries ?? ''));
  }, [stats]);

  const handleSaveConfig = async () => {
    setCfgBusy(true);
    setCfgMsg('');
    try {
      const ttl  = draftTtl  !== '' ? parseInt(draftTtl,  10) : undefined;
      const maxE = draftMax  !== '' ? parseInt(draftMax, 10) : undefined;
      const s = await setCacheConfig({
        enabled: draftEnabled,
        ttl_secs:    Number.isFinite(ttl)  && ttl  > 0 ? ttl  : undefined,
        max_entries: Number.isFinite(maxE) && maxE > 0 ? maxE : undefined,
      });
      onStatsUpdate(s);
      setCfgMsg('Saved.');
      setTimeout(() => setCfgMsg(''), 3000);
    } catch (e) {
      console.error('[CachePanel] config failed:', e);
      setCfgMsg(`Error: ${e.message}`);
    } finally {
      setCfgBusy(false);
    }
  };

  return (
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
        <Button variant="primary" size="sm" onClick={handleSaveConfig} disabled={cfgBusy}>
          {cfgBusy ? 'Saving…' : 'Save config'}
        </Button>
        {cfgMsg && (
          <span style={{ fontSize: '0.78rem', color: cfgMsg.startsWith('Error') ? 'var(--brew-kv-crit, #e55)' : '#9ec99e' }}>
            {cfgMsg}
          </span>
        )}
      </div>
    </div>
  );
}
