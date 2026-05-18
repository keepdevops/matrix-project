import React, { useState, useEffect, useCallback } from 'react';
import {
  fetchModes,
  fetchModeAgents,
  setModeAgents,
  fetchAgents,
  fetchAgentHealth,
} from '../api/swarmApi';
import RosterGrid from './RosterGrid';
import PipelineOrderEditor from './PipelineOrderEditor';
import ModeOptions from './ModeOptions';

// Per-mode agent roster editor. Lets the user pick which agents participate
// in pipeline / router / cascade (flat mode ignores roster — full swarm).
// Persists via PUT /api/modes/<name>/agents on the coordinator.
export default function ModeRosterPanel() {
  const [modes, setModes]               = useState([]);
  const [activeTab, setActiveTab]       = useState(null);
  const [available, setAvailable]       = useState([]);
  const [selected, setSelected]         = useState([]);
  const [explicit, setExplicit]         = useState(false);
  const [maxSelect, setMaxSelect]       = useState('');
  const [synthesizer, setSynthesizer]   = useState('');
  const [variantPolicy, setVariantPolicy]     = useState('standard');
  const [pipelinePreset, setPipelinePreset]   = useState('');
  const [synthesisPolicy, setSynthesisPolicy] = useState('summary');
  const [classifierPolicy, setClassifierPolicy] = useState('standard');
  const [health, setHealth]             = useState({});
  const [pipelineOrder, setPipelineOrder]       = useState([]);
  const [usePipelineOrder, setUsePipelineOrder] = useState(false);
  const [stageContextChars, setStageContextChars] = useState('');
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState(null);
  const [staleAgents, setStaleAgents] = useState([]);
  const [savedAt, setSavedAt] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      fetchAgentHealth().then(snap => {
        if (cancelled) return;
        const out = {};
        Object.entries(snap || {}).forEach(([k, v]) => {
          if (k !== '__config') out[k] = v;
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
        setStaleAgents([]);
        const data = await fetchModeAgents(activeTab);
        if (cancelled) return;
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
          setStaleAgents(data.stale);
        }
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
    })();
    return () => { cancelled = true; };
  }, [activeTab]);

  const isPipeline = activeTab === 'pipeline';

  const addAgent   = name => setSelected(prev => (isPipeline || !prev.includes(name)) ? [...prev, name] : prev);
  const removeAt   = index => setSelected(prev => prev.filter((_, i) => i !== index));
  const moveAgent  = (index, dir) => setSelected(prev => {
    const j = index + dir;
    if (j < 0 || j >= prev.length) return prev;
    const next = prev.slice();
    [next[index], next[j]] = [next[j], next[index]];
    return next;
  });

  const save = async () => {
    if (!activeTab) return;
    setBusy(true); setError(null); setStaleAgents([]);
    try {
      const opts = {};
      const parsed = parseInt(maxSelect, 10);
      if (activeTab === 'router' && Number.isInteger(parsed) && parsed >= 1) opts.maxSelect = parsed;
      if (activeTab === 'pipeline' || activeTab === 'cascade') opts.synthesizer = synthesizer || '';
      if (activeTab === 'flat')     opts.variant_policy    = variantPolicy;
      if (activeTab === 'pipeline') opts.preset            = pipelinePreset;
      if (activeTab === 'cascade')  opts.synthesis_policy  = synthesisPolicy;
      if (activeTab === 'router')   opts.classifier_policy = classifierPolicy;
      if (activeTab === 'pipeline' && usePipelineOrder) {
        opts.order = pipelineOrder.length ? pipelineOrder : null;
      }
      if (activeTab === 'pipeline' && stageContextChars !== '') {
        const scc = parseInt(stageContextChars, 10);
        if (Number.isInteger(scc) && scc > 0) opts.stage_context_chars = scc;
      }
      const res = await setModeAgents(activeTab, selected, opts);
      const savedAgents = Array.isArray(res?.agents) ? res.agents : [];
      setSelected(savedAgents);
      setExplicit(savedAgents.length > 0);
      if (activeTab === 'pipeline' && usePipelineOrder && res
          && Object.prototype.hasOwnProperty.call(res, 'order')) {
        if (res.order === null || res.order === undefined) {
          setPipelineOrder([]); setUsePipelineOrder(false);
        } else if (Array.isArray(res.order)) {
          setPipelineOrder(res.order);
          setUsePipelineOrder(res.order.length > 0);
        }
      }
      setSavedAt(Date.now());
      const skipped = [];
      if (Array.isArray(res?.unknown) && res.unknown.length) skipped.push(`agents: ${res.unknown.join(', ')}`);
      if (res?.unknown_order?.length) skipped.push(`order: ${res.unknown_order.join(', ')}`);
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
      if (activeTab === 'pipeline') { setPipelineOrder([]); setUsePipelineOrder(false); }
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

  return (
    <div className="swarm-config-section" style={{ padding: '0.75rem' }}>
      <div className="swarm-config-title">PER-MODE ROSTER</div>
      <div style={{ fontSize: '0.8rem', opacity: 0.7, marginBottom: '0.5rem' }}>
        Pick which agents answer in each mode. Order matters for pipeline.
        Empty list ⇒ mode uses the full deployed roster.
      </div>

      {tripped.length > 0 && (
        <div style={{
          fontSize: '0.78rem', background: '#3a1010',
          border: '1px solid #ff4444', padding: '0.3rem 0.5rem',
          marginBottom: '0.5rem', borderRadius: '3px',
        }}>
          🔴 circuit breaker open: {tripped.map(t => `${t.name} (${t.cooldown_s}s)`).join(', ')}
          <span style={{ opacity: 0.7, marginLeft: '0.4rem' }}>
            — these agents are skipped on dispatch until cooldown elapses.
          </span>
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '0.5rem' }}>
        {modes.map(m => (
          <button key={m.name} onClick={() => setActiveTab(m.name)}
                  className="swarm-deploy-btn"
                  style={{ padding: '0.25rem 0.6rem',
                           opacity: activeTab === m.name ? 1 : 0.55,
                           fontWeight: activeTab === m.name ? 700 : 400 }}>
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

      <RosterGrid selected={selected} available={available} isPipeline={isPipeline}
                  onAdd={addAgent} onRemove={removeAt} onMove={moveAgent} />

      <ModeOptions
        activeTab={activeTab} available={available}
        synthesizer={synthesizer} setSynthesizer={setSynthesizer}
        variantPolicy={variantPolicy} setVariantPolicy={setVariantPolicy}
        pipelinePreset={pipelinePreset} setPipelinePreset={setPipelinePreset}
        stageContextChars={stageContextChars} setStageContextChars={setStageContextChars}
        synthesisPolicy={synthesisPolicy} setSynthesisPolicy={setSynthesisPolicy}
        classifierPolicy={classifierPolicy} setClassifierPolicy={setClassifierPolicy}
        maxSelect={maxSelect} setMaxSelect={setMaxSelect}
      />

      {isPipeline && (
        <PipelineOrderEditor
          pipelineOrder={pipelineOrder} setPipelineOrder={setPipelineOrder}
          usePipelineOrder={usePipelineOrder} setUsePipelineOrder={setUsePipelineOrder}
          selected={selected} available={available} pipelinePreset={pipelinePreset}
        />
      )}

      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem', alignItems: 'center' }}>
        <button onClick={save} disabled={busy} className="swarm-deploy-btn"
                style={{ padding: '0.3rem 0.8rem' }}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button onClick={clearOverride}
                disabled={busy || (!explicit && selected.length === 0)}
                style={{ padding: '0.3rem 0.8rem' }}>
          Clear override
        </button>
        {error && <span style={{ color: '#ff7777', fontSize: '0.8rem' }}>{error}</span>}
        {!error && staleAgents.length > 0 && (
          <span style={{ color: '#ffaa44', fontSize: '0.8rem' }}>
            ⚠ Not deployed: {staleAgents.join(', ')} — save to drop, or redeploy
          </span>
        )}
        {!error && !staleAgents.length && savedAt && (
          <span style={{ opacity: 0.7, fontSize: '0.8rem' }}>
            saved {new Date(savedAt).toLocaleTimeString()}
          </span>
        )}
      </div>
    </div>
  );
}
