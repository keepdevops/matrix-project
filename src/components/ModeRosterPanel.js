import React, { useState, useEffect, useCallback } from 'react';
import {
  fetchModes,
  fetchModeAgents,
  setModeAgents,
  fetchAgents,
  fetchAgentHealth,
} from '../api/swarmApi';

// Per-mode agent roster editor. Lets the user pick which agents participate
// in flat / pipeline / router, and (for pipeline) the order they run in.
// Persists via PUT /api/modes/<name>/agents on the coordinator.
//
// Empty roster ⇒ mode falls back to the full deployed roster (server-side
// behavior in coordinator.cpp::filter_agents_for_mode).
export default function ModeRosterPanel() {
  const [modes, setModes] = useState([]);
  const [activeTab, setActiveTab] = useState(null);
  const [available, setAvailable] = useState([]);
  const [selected, setSelected] = useState([]); // ordered names for active tab
  const [explicit, setExplicit] = useState(false);
  const [maxSelect, setMaxSelect] = useState('');
  const [synthesizer, setSynthesizer] = useState('');
  const [health, setHealth] = useState({}); // { name: { tripped, cooldown_remaining_ms } }

  // Poll agent health every 5s. Light enough to be safe; the snapshot is in-memory.
  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      fetchAgentHealth().then(snap => {
        if (cancelled) return;
        const out = {};
        Object.entries(snap || {}).forEach(([k, v]) => {
          if (k === '__config') return;
          out[k] = v;
        });
        setHealth(out);
      }).catch(() => {});
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const tripped = Object.entries(health)
    .filter(([, v]) => v && v.tripped)
    .map(([name, v]) => ({ name, cooldown_s: Math.ceil((v.cooldown_remaining_ms || 0) / 1000) }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [savedAt, setSavedAt] = useState(null);

  const loadModes = useCallback(async () => {
    try {
      const [m, a] = await Promise.all([fetchModes(), fetchAgents()]);
      setModes(m);
      setAvailable((a || []).map(x => x.name));
      if (!activeTab && m.length) {
        setActiveTab((m.find(x => x.active) || m[0]).name);
      }
    } catch (e) {
      setError(e.message);
    }
  }, [activeTab]);

  useEffect(() => { loadModes(); }, [loadModes]);

  // React when a preset is applied elsewhere in the UI: refetch modes (so the
  // active-mode dot moves) and re-load the active tab's config.
  useEffect(() => {
    const onChange = (e) => {
      loadModes();
      if (e?.detail?.mode) setActiveTab(e.detail.mode);
    };
    window.addEventListener('mode-roster-changed', onChange);
    return () => window.removeEventListener('mode-roster-changed', onChange);
  }, [loadModes]);

  useEffect(() => {
    if (!activeTab) return;
    let cancelled = false;
    (async () => {
      try {
        setError(null);
        const data = await fetchModeAgents(activeTab);
        if (cancelled) return;
        setSelected(data.explicit ? data.agents : []);
        setExplicit(!!data.explicit);
        if (data.available) setAvailable(data.available);
        setMaxSelect(Number.isInteger(data.max_select) ? String(data.max_select) : '');
        setSynthesizer(typeof data.synthesizer === 'string' ? data.synthesizer : '');
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
    })();
    return () => { cancelled = true; };
  }, [activeTab]);

  const isPipeline = activeTab === 'pipeline';

  const toggle = name => {
    setSelected(prev => prev.includes(name)
      ? prev.filter(n => n !== name)
      : [...prev, name]);
  };

  const move = (name, dir) => {
    setSelected(prev => {
      const i = prev.indexOf(name);
      if (i < 0) return prev;
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = prev.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  const save = async () => {
    if (!activeTab) return;
    setBusy(true); setError(null);
    try {
      const opts = {};
      const parsed = parseInt(maxSelect, 10);
      if (activeTab === 'router' && Number.isInteger(parsed) && parsed >= 1) {
        opts.maxSelect = parsed;
      }
      if (activeTab === 'pipeline' || activeTab === 'cascade') {
        opts.synthesizer = synthesizer || '';
      }
      const res = await setModeAgents(activeTab, selected, opts);
      setSavedAt(Date.now());
      setExplicit(selected.length > 0);
      if (res && Array.isArray(res.unknown) && res.unknown.length) {
        setError(`Skipped unknown agents: ${res.unknown.join(', ')}`);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const clearOverride = async () => {
    setBusy(true); setError(null);
    try {
      await setModeAgents(activeTab, []);
      setSelected([]);
      setExplicit(false);
      setSavedAt(Date.now());
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!modes.length) {
    return (
      <div className="swarm-config-section" style={{ padding: '0.75rem' }}>
        <div className="swarm-config-title">PER-MODE ROSTER</div>
        <div style={{ opacity: 0.7, fontSize: '0.85rem' }}>
          {error ? `Error: ${error}` : 'Loading modes…'}
        </div>
      </div>
    );
  }

  const inactive = available.filter(n => !selected.includes(n));

  return (
    <div className="swarm-config-section" style={{ padding: '0.75rem' }}>
      <div className="swarm-config-title">PER-MODE ROSTER</div>
      <div style={{ fontSize: '0.8rem', opacity: 0.7, marginBottom: '0.5rem' }}>
        Pick which agents answer in each mode. Order matters for pipeline.
        Empty list ⇒ mode uses the full deployed roster.
      </div>

      {tripped.length > 0 && (
        <div style={{
          fontSize: '0.78rem',
          background: '#3a1010',
          border: '1px solid #ff4444',
          padding: '0.3rem 0.5rem',
          marginBottom: '0.5rem',
          borderRadius: '3px',
        }}>
          🔴 circuit breaker open: {tripped.map(t => `${t.name} (${t.cooldown_s}s)`).join(', ')}
          <span style={{ opacity: 0.7, marginLeft: '0.4rem' }}>
            — these agents are skipped on dispatch until cooldown elapses.
          </span>
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '0.5rem' }}>
        {modes.map(m => (
          <button
            key={m.name}
            onClick={() => setActiveTab(m.name)}
            className="swarm-deploy-btn"
            style={{
              padding: '0.25rem 0.6rem',
              opacity: activeTab === m.name ? 1 : 0.55,
              fontWeight: activeTab === m.name ? 700 : 400,
            }}
          >
            {m.name}{m.active ? ' ●' : ''}
          </button>
        ))}
      </div>

      {!explicit && selected.length === 0 && (
        <div style={{ fontSize: '0.8rem', opacity: 0.7, marginBottom: '0.4rem' }}>
          No override set — `{activeTab}` is using the full roster
          ({available.length} agent{available.length === 1 ? '' : 's'}).
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
        <div>
          <div style={{ fontSize: '0.75rem', opacity: 0.7, marginBottom: '0.25rem' }}>
            SELECTED {isPipeline && selected.length > 1 ? '(↑/↓ reorders pipeline)' : ''}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
            {selected.length === 0 && (
              <div style={{ opacity: 0.5, fontSize: '0.8rem' }}>— none —</div>
            )}
            {selected.map((name, i) => (
              <div key={name}
                   style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                <span style={{ fontSize: '0.7rem', opacity: 0.6, width: '1.2rem' }}>
                  {i + 1}.
                </span>
                <span style={{ flex: 1, fontSize: '0.85rem' }}>{name}</span>
                {isPipeline && (
                  <>
                    <button onClick={() => move(name, -1)}
                            disabled={i === 0}
                            style={{ padding: '0 0.3rem' }}>↑</button>
                    <button onClick={() => move(name, +1)}
                            disabled={i === selected.length - 1}
                            style={{ padding: '0 0.3rem' }}>↓</button>
                  </>
                )}
                <button onClick={() => toggle(name)}
                        style={{ padding: '0 0.3rem' }}>✕</button>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div style={{ fontSize: '0.75rem', opacity: 0.7, marginBottom: '0.25rem' }}>
            AVAILABLE
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
            {inactive.length === 0 && (
              <div style={{ opacity: 0.5, fontSize: '0.8rem' }}>— all selected —</div>
            )}
            {inactive.map(name => (
              <button key={name}
                      onClick={() => toggle(name)}
                      style={{
                        textAlign: 'left',
                        padding: '0.2rem 0.4rem',
                        fontSize: '0.85rem',
                      }}>
                + {name}
              </button>
            ))}
          </div>
        </div>
      </div>

      {(activeTab === 'pipeline' || activeTab === 'cascade') && (
        <div style={{ marginTop: '0.5rem', fontSize: '0.85rem',
                      display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
          <label>synthesizer</label>
          <select
            value={synthesizer}
            onChange={e => setSynthesizer(e.target.value)}
            style={{ padding: '0.15rem 0.3rem' }}
          >
            <option value="">— none (last stage is final) —</option>
            {available.map(n => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
          <span style={{ opacity: 0.6, fontSize: '0.75rem' }}>
            ({activeTab === 'cascade'
              ? 'reduces parallel responses into one final answer'
              : 'reduces all stage outputs into one final answer'})
          </span>
        </div>
      )}

      {activeTab === 'router' && (
        <div style={{ marginTop: '0.5rem', fontSize: '0.85rem',
                      display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
          <label>max responders</label>
          <input
            type="number"
            min="1"
            max={Math.max(available.length, 1)}
            value={maxSelect}
            onChange={e => setMaxSelect(e.target.value)}
            style={{ width: '4rem', padding: '0.15rem 0.3rem' }}
          />
          <span style={{ opacity: 0.6, fontSize: '0.75rem' }}>
            (foreman picks up to this many roles per prompt)
          </span>
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem',
                    alignItems: 'center' }}>
        <button onClick={save}
                disabled={busy}
                className="swarm-deploy-btn"
                style={{ padding: '0.3rem 0.8rem' }}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button onClick={clearOverride}
                disabled={busy || (!explicit && selected.length === 0)}
                style={{ padding: '0.3rem 0.8rem' }}>
          Clear override
        </button>
        {error && (
          <span style={{ color: '#ff7777', fontSize: '0.8rem' }}>{error}</span>
        )}
        {!error && savedAt && (
          <span style={{ opacity: 0.7, fontSize: '0.8rem' }}>
            saved {new Date(savedAt).toLocaleTimeString()}
          </span>
        )}
      </div>
    </div>
  );
}
