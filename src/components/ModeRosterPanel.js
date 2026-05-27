import React, { useState, useEffect, useCallback } from 'react';
import Button from './Button';
import { fetchModes, fetchModeAgents, fetchAgents } from '../api/swarmApi';
import RosterGrid from './RosterGrid';
import PipelineOrderEditor from './PipelineOrderEditor';
import ModeOptions from './ModeOptions';
import { useModeHealth } from '../hooks/useModeHealth';
import { useModeSave } from '../hooks/useModeSave';

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
  const [pipelineOrder, setPipelineOrder]       = useState([]);
  const [usePipelineOrder, setUsePipelineOrder] = useState(false);
  const [stageContextChars, setStageContextChars] = useState('');

  const { tripped } = useModeHealth();
  const { busy, error, staleAgents, savedAt, save, clearOverride } = useModeSave({
    setSelected, setExplicit, setPipelineOrder, setUsePipelineOrder,
  });

  const loadModes = useCallback(async () => {
    try {
      const [m, a] = await Promise.all([fetchModes(), fetchAgents()]);
      setModes(m);
      setAvailable((a || []).map(x => x.name));
      setActiveTab(prev => prev || (m.find(x => x.active) || m[0])?.name || null);
    } catch (e) {
      console.error('[ModeRosterPanel] loadModes failed:', e);
    }
  }, []);

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
      } catch (e) {
        if (!cancelled) { setSelected([]); setExplicit(false); }
        console.error('ModeRosterPanel: fetchModeAgents failed:', e);
      }
    })();
    return () => { cancelled = true; };
  }, [activeTab]);

  const isPipeline = activeTab === 'pipeline';
  const addAgent  = name => setSelected(prev => (isPipeline || !prev.includes(name)) ? [...prev, name] : prev);
  const removeAt  = index => setSelected(prev => prev.filter((_, i) => i !== index));
  const moveAgent = (index, dir) => setSelected(prev => {
    const j = index + dir;
    if (j < 0 || j >= prev.length) return prev;
    const next = prev.slice();
    [next[index], next[j]] = [next[j], next[index]];
    return next;
  });

  const handleSave = () => save(activeTab, selected, {
    maxSelect, synthesizer, variantPolicy, pipelinePreset,
    synthesisPolicy, classifierPolicy, usePipelineOrder, pipelineOrder, stageContextChars,
  });

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
          <Button
            key={m.name}
            variant="ghost"
            size="sm"
            className="swarm-deploy-btn"
            onClick={() => setActiveTab(m.name)}
            style={{
              opacity: activeTab === m.name ? 1 : 0.55,
              fontWeight: activeTab === m.name ? 700 : 400,
            }}
          >
            {m.name}{m.active ? ' ●' : ''}
          </Button>
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
        <Button variant="outline-primary" size="sm" onClick={handleSave} disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => clearOverride(activeTab)}
          disabled={busy || (!explicit && selected.length === 0)}
        >
          Clear override
        </Button>
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
