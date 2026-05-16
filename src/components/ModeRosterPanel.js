import React, { useState, useEffect, useCallback } from 'react';
import {
  fetchModes,
  fetchModeAgents,
  setModeAgents,
  fetchAgents,
  fetchAgentHealth,
} from '../api/swarmApi';

function presetStageOrder(preset, agentNames) {
  const avail = new Set(agentNames);
  const push = (out, n) => {
    if (avail.has(n)) out.push(n);
  };
  const out = [];
  if (preset === 'code-quality') {
    push(out, 'architect');
    push(out, 'programmer');
    push(out, 'tester');
    push(out, 'programmer');
  } else if (preset === 'debug-fix') {
    push(out, 'tester');
    push(out, 'programmer');
    push(out, 'tester');
  } else if (preset === 'docs-finalize') {
    push(out, 'programmer');
    push(out, 'documenter');
  }
  return out;
}

// Per-mode agent roster editor. Lets the user pick which agents participate
// in pipeline / router / cascade (flat mode ignores roster — full swarm).
// Persists via PUT /api/modes/<name>/agents on the coordinator.
//
// Empty roster ⇒ mode falls back to the full deployed roster (except flat,
// which always uses everyone — server-side filter_agents_for_mode).
export default function ModeRosterPanel() {
  const [modes, setModes] = useState([]);
  const [activeTab, setActiveTab] = useState(null);
  const [available, setAvailable] = useState([]);
  const [selected, setSelected] = useState([]); // ordered names for active tab
  const [explicit, setExplicit] = useState(false);
  const [maxSelect, setMaxSelect] = useState('');
  const [synthesizer, setSynthesizer] = useState('');
  const [variantPolicy, setVariantPolicy] = useState('standard');
  const [pipelinePreset, setPipelinePreset] = useState('');
  const [synthesisPolicy, setSynthesisPolicy] = useState('summary');
  const [classifierPolicy, setClassifierPolicy] = useState('standard');
  const [health, setHealth] = useState({}); // { name: { tripped, cooldown_remaining_ms } }

  const [pipelineOrder, setPipelineOrder] = useState([]);
  const [usePipelineOrder, setUsePipelineOrder] = useState(false);
  const [stageContextChars, setStageContextChars] = useState('');

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
        // `agents` is now intersected with deployed; `stale` lists names the
        // operator configured but that are no longer deployed. Surface stale
        // explicitly instead of silently dropping or round-tripping it.
        setSelected(data.explicit ? (data.agents || []) : []);
        setExplicit(!!data.explicit);
        if (data.available) setAvailable(data.available);
        setMaxSelect(Number.isInteger(data.max_select) ? String(data.max_select) : '');
        setSynthesizer(typeof data.synthesizer === 'string' ? data.synthesizer : '');
        setVariantPolicy(typeof data.variant_policy === 'string' ? data.variant_policy : 'standard');
        setPipelinePreset(typeof data.preset === 'string' ? data.preset : '');
        setSynthesisPolicy(typeof data.synthesis_policy === 'string' ? data.synthesis_policy : 'summary');
        setClassifierPolicy(typeof data.classifier_policy === 'string' ? data.classifier_policy : 'standard');
        const ord = Array.isArray(data.order) ? data.order : [];
        setPipelineOrder(ord);
        setUsePipelineOrder(ord.length > 0);
        if (Array.isArray(data.stale) && data.stale.length) {
          setError(`Configured but not deployed: ${data.stale.join(', ')} — save to drop, or redeploy.`);
        }
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
    })();
    return () => { cancelled = true; };
  }, [activeTab]);

  const isPipeline = activeTab === 'pipeline';

  const addAgent = name => {
    setSelected(prev => (isPipeline || !prev.includes(name))
      ? [...prev, name]
      : prev);
  };

  const removeAt = index => {
    setSelected(prev => prev.filter((_, i) => i !== index));
  };

  const move = (index, dir) => {
    setSelected(prev => {
      const j = index + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = prev.slice();
      [next[index], next[j]] = [next[j], next[index]];
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
      if (activeTab === 'flat') opts.variant_policy = variantPolicy;
      if (activeTab === 'pipeline') opts.preset = pipelinePreset;
      if (activeTab === 'cascade') opts.synthesis_policy = synthesisPolicy;
      if (activeTab === 'router') opts.classifier_policy = classifierPolicy;
      if (activeTab === 'pipeline' && usePipelineOrder) {
        opts.order = pipelineOrder.length ? pipelineOrder : null;
      }
      if (activeTab === 'pipeline' && stageContextChars !== '') {
        const scc = parseInt(stageContextChars, 10);
        if (Number.isInteger(scc) && scc > 0) opts.stage_context_chars = scc;
      }
      const res = await setModeAgents(activeTab, selected, opts);
      // Trust server-normalized roster: it reflects what was actually persisted
      // after filtering ghost names. Avoids UI/disk divergence until next refetch.
      const savedAgents = Array.isArray(res?.agents) ? res.agents : [];
      setSelected(savedAgents);
      setExplicit(savedAgents.length > 0);
      if (activeTab === 'pipeline' && usePipelineOrder && res
          && Object.prototype.hasOwnProperty.call(res, 'order')) {
        if (res.order === null || res.order === undefined) {
          setPipelineOrder([]);
          setUsePipelineOrder(false);
        } else if (Array.isArray(res.order)) {
          setPipelineOrder(res.order);
          setUsePipelineOrder(res.order.length > 0);
        }
      }
      setSavedAt(Date.now());
      const skipped = [];
      if (Array.isArray(res?.unknown) && res.unknown.length) {
        skipped.push(`agents: ${res.unknown.join(', ')}`);
      }
      if (res?.unknown_order?.length) {
        skipped.push(`order: ${res.unknown_order.join(', ')}`);
      }
      setError(skipped.length ? `Skipped (not deployed) — ${skipped.join('; ')}` : null);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const clearOverride = async () => {
    setBusy(true); setError(null);
    try {
      const extra = activeTab === 'pipeline' ? { order: null } : {};
      const res = await setModeAgents(activeTab, [], extra);
      const savedAgents = Array.isArray(res?.agents) ? res.agents : [];
      setSelected(savedAgents);
      setExplicit(savedAgents.length > 0);
      if (activeTab === 'pipeline') {
        setPipelineOrder([]);
        setUsePipelineOrder(false);
      }
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

  const inactive = isPipeline ? available : available.filter(n => !selected.includes(n));

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
              <div key={`${name}-${i}`}
                   style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                <span style={{ fontSize: '0.7rem', opacity: 0.6, width: '1.2rem' }}>
                  {i + 1}.
                </span>
                <span style={{ flex: 1, fontSize: '0.85rem' }}>{name}</span>
                {isPipeline && (
                  <>
                    <button onClick={() => move(i, -1)}
                            disabled={i === 0}
                            style={{ padding: '0 0.3rem' }}>↑</button>
                    <button onClick={() => move(i, +1)}
                            disabled={i === selected.length - 1}
                            style={{ padding: '0 0.3rem' }}>↓</button>
                  </>
                )}
                <button onClick={() => removeAt(i)}
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
                      onClick={() => addAgent(name)}
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

      {activeTab === 'flat' && (
        <div style={{ marginTop: '0.5rem', fontSize: '0.85rem',
                      display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
          <label>variant policy</label>
          <select
            value={variantPolicy}
            onChange={e => setVariantPolicy(e.target.value)}
            style={{ padding: '0.15rem 0.3rem' }}
          >
            <option value="standard">standard</option>
            <option value="distinct">distinct variants</option>
            <option value="code-alternatives">code alternatives</option>
          </select>
        </div>
      )}

      {activeTab === 'pipeline' && (
        <div style={{ marginTop: '0.5rem', fontSize: '0.85rem',
                      display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
          <label>preset</label>
          <select
            value={pipelinePreset}
            onChange={e => setPipelinePreset(e.target.value)}
            style={{ padding: '0.15rem 0.3rem' }}
          >
            <option value="">custom roster/order</option>
            <option value="code-quality">code-quality</option>
            <option value="debug-fix">debug-fix</option>
            <option value="docs-finalize">docs-finalize</option>
          </select>
          <span style={{ opacity: 0.6, fontSize: '0.75rem' }}>
            (used when no explicit stage roster/order is saved)
          </span>
        </div>
      )}

      {activeTab === 'pipeline' && (
        <div style={{ marginTop: '0.4rem', fontSize: '0.85rem', display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
          <label title="Max chars of prior-stage output passed as context to each stage. Leave blank for server default.">stage ctx chars</label>
          <input
            type="number"
            min={256}
            step={256}
            value={stageContextChars}
            onChange={e => setStageContextChars(e.target.value)}
            placeholder="server default"
            style={{ padding: '0.15rem 0.3rem', width: '8rem' }}
          />
        </div>
      )}

      {activeTab === 'pipeline' && (
        <div style={{
          marginTop: '0.55rem',
          padding: '0.45rem',
          border: '1px solid rgba(128,128,128,0.35)',
          borderRadius: 4,
          fontSize: '0.82rem',
        }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={usePipelineOrder}
              onChange={e => {
                const on = e.target.checked;
                setUsePipelineOrder(on);
                if (on && pipelineOrder.length === 0 && selected.length > 0) {
                  setPipelineOrder([...selected]);
                }
              }}
            />
            Use explicit stage order (allows duplicate roles)
          </label>
          {usePipelineOrder && (
            <>
              <div style={{ marginTop: '0.45rem', opacity: 0.75, fontSize: '0.78rem' }}>
                Stages run in this sequence. Names must be deployed; duplicates are allowed (e.g. programmer twice).
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', marginTop: '0.35rem' }}>
                {pipelineOrder.length === 0 && (
                  <span style={{ opacity: 0.55 }}>— empty — add stages below or apply preset</span>
                )}
                {pipelineOrder.map((name, i) => (
                  <div key={`${name}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <span style={{ opacity: 0.55, width: '1.5rem' }}>{i + 1}.</span>
                    <span style={{ flex: 1 }}>{name}</span>
                    <button type="button" style={{ padding: '0 0.25rem' }} disabled={i === 0}
                      onClick={() => setPipelineOrder(prev => {
                        const n = [...prev];
                        [n[i - 1], n[i]] = [n[i], n[i - 1]];
                        return n;
                      })}>↑</button>
                    <button type="button" style={{ padding: '0 0.25rem' }} disabled={i === pipelineOrder.length - 1}
                      onClick={() => setPipelineOrder(prev => {
                        const n = [...prev];
                        [n[i], n[i + 1]] = [n[i + 1], n[i]];
                        return n;
                      })}>↓</button>
                    <button type="button" style={{ padding: '0 0.25rem' }}
                      onClick={() => setPipelineOrder(prev => prev.filter((_, j) => j !== i))}>✕</button>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: '0.45rem', display: 'flex', flexWrap: 'wrap', gap: '0.35rem', alignItems: 'center' }}>
                <span>Add stage:</span>
                <select
                  defaultValue=""
                  onChange={e => {
                    const v = e.target.value;
                    if (v) {
                      setPipelineOrder(prev => [...prev, v]);
                      e.target.value = '';
                    }
                  }}
                  style={{ padding: '0.15rem 0.3rem' }}
                >
                  <option value="">— role —</option>
                  {available.map(n => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
                <button
                  type="button"
                  className="swarm-deploy-btn"
                  style={{ padding: '0.15rem 0.45rem' }}
                  disabled={!pipelinePreset}
                  onClick={() => {
                    const next = presetStageOrder(pipelinePreset, available);
                    setPipelineOrder(next);
                    setUsePipelineOrder(true);
                  }}
                >
                  Apply preset to stage order
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {activeTab === 'cascade' && (
        <div style={{ marginTop: '0.5rem', fontSize: '0.85rem',
                      display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
          <label>synthesis policy</label>
          <select
            value={synthesisPolicy}
            onChange={e => setSynthesisPolicy(e.target.value)}
            style={{ padding: '0.15rem 0.3rem' }}
          >
            <option value="summary">summary</option>
            <option value="full-code">full-code</option>
            <option value="best-answer-plus-fixes">best-answer-plus-fixes</option>
            <option value="tradeoff-comparison">tradeoff-comparison</option>
          </select>
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

      {activeTab === 'router' && (
        <div style={{ marginTop: '0.5rem', fontSize: '0.85rem',
                      display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
          <label>classifier policy</label>
          <select
            value={classifierPolicy}
            onChange={e => setClassifierPolicy(e.target.value)}
            style={{ padding: '0.15rem 0.3rem' }}
          >
            <option value="standard">standard</option>
            <option value="code">code</option>
            <option value="debug">debug</option>
            <option value="docs">docs</option>
            <option value="ops">ops</option>
          </select>
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
