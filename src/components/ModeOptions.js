import React from 'react';

const row = { marginTop: '0.5rem', fontSize: '0.85rem', display: 'flex', gap: '0.4rem', alignItems: 'center' };
const sel  = { padding: '0.15rem 0.3rem' };
const hint = { opacity: 0.6, fontSize: '0.75rem' };

export default function ModeOptions({
  activeTab, available,
  synthesizer, setSynthesizer,
  variantPolicy, setVariantPolicy,
  pipelinePreset, setPipelinePreset,
  stageContextChars, setStageContextChars,
  synthesisPolicy, setSynthesisPolicy,
  classifierPolicy, setClassifierPolicy,
  maxSelect, setMaxSelect,
}) {
  return (
    <>
      {(activeTab === 'pipeline' || activeTab === 'cascade') && (
        <div style={row}>
          <label htmlFor="mo-synthesizer">synthesizer</label>
          <select id="mo-synthesizer" value={synthesizer} onChange={e => setSynthesizer(e.target.value)} style={sel}>
            <option value="">— none (last stage is final) —</option>
            {available.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <span style={hint}>
            ({activeTab === 'cascade'
              ? 'reduces parallel responses into one final answer'
              : 'reduces all stage outputs into one final answer'})
          </span>
        </div>
      )}

      {activeTab === 'flat' && (
        <div style={row}>
          <label htmlFor="mo-variant-policy">variant policy</label>
          <select id="mo-variant-policy" value={variantPolicy} onChange={e => setVariantPolicy(e.target.value)} style={sel}>
            <option value="standard">standard</option>
            <option value="distinct">distinct variants</option>
            <option value="code-alternatives">code alternatives</option>
          </select>
        </div>
      )}

      {activeTab === 'pipeline' && (
        <div style={row}>
          <label htmlFor="mo-pipeline-preset">preset</label>
          <select id="mo-pipeline-preset" value={pipelinePreset} onChange={e => setPipelinePreset(e.target.value)} style={sel}>
            <option value="">custom roster/order</option>
            <option value="code-quality">code-quality</option>
            <option value="debug-fix">debug-fix</option>
            <option value="docs-finalize">docs-finalize</option>
          </select>
          <span style={hint}>(used when no explicit stage roster/order is saved)</span>
        </div>
      )}

      {activeTab === 'pipeline' && (
        <div style={{ ...row, marginTop: '0.4rem' }}>
          <label
            htmlFor="mo-stage-ctx-chars"
            title="Max chars of prior-stage output passed as context to each stage. Leave blank for server default."
          >
            stage ctx chars
          </label>
          <input id="mo-stage-ctx-chars" type="number" min={256} step={256}
                 value={stageContextChars}
                 onChange={e => setStageContextChars(e.target.value)}
                 placeholder="server default"
                 style={{ padding: '0.15rem 0.3rem', width: '8rem' }} />
        </div>
      )}

      {activeTab === 'cascade' && (
        <div style={row}>
          <label htmlFor="mo-synthesis-policy">synthesis policy</label>
          <select id="mo-synthesis-policy" value={synthesisPolicy} onChange={e => setSynthesisPolicy(e.target.value)} style={sel}>
            <option value="summary">summary</option>
            <option value="full-code">full-code</option>
            <option value="best-answer-plus-fixes">best-answer-plus-fixes</option>
            <option value="tradeoff-comparison">tradeoff-comparison</option>
          </select>
        </div>
      )}

      {activeTab === 'router' && (
        <div style={row}>
          <label htmlFor="mo-max-responders">max responders</label>
          <input id="mo-max-responders" type="number" min="1" max={Math.max(available.length, 1)}
                 value={maxSelect} onChange={e => setMaxSelect(e.target.value)}
                 style={{ width: '4rem', padding: '0.15rem 0.3rem' }} />
          <span style={hint}>(foreman picks up to this many roles per prompt)</span>
        </div>
      )}

      {activeTab === 'router' && (
        <div style={row}>
          <label htmlFor="mo-classifier-policy">classifier policy</label>
          <select id="mo-classifier-policy" value={classifierPolicy} onChange={e => setClassifierPolicy(e.target.value)} style={sel}>
            <option value="standard">standard</option>
            <option value="code">code</option>
            <option value="debug">debug</option>
            <option value="docs">docs</option>
            <option value="ops">ops</option>
          </select>
        </div>
      )}
    </>
  );
}
