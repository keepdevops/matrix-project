import React from 'react';
import RosterGrid from './RosterGrid';
import PipelineOrderEditor from './PipelineOrderEditor';
import ModeOptions from './ModeOptions';
import { useModeHealth } from '../hooks/useModeHealth';
import { useModeRosterState } from './useModeRosterState';
import {
  CircuitBreakerBanner, ModeTabBar, OverrideToggle, RosterFooter,
} from './ModeRosterPanelControls';

export default function ModeRosterPanel() {
  const { tripped } = useModeHealth();
  const {
    modes, activeTab, setActiveTab,
    available, selected, setSelected,
    explicit, setExplicit,
    maxSelect, setMaxSelect,
    synthesizer, setSynthesizer,
    variantPolicy, setVariantPolicy,
    pipelinePreset, setPipelinePreset,
    synthesisPolicy, setSynthesisPolicy,
    classifierPolicy, setClassifierPolicy,
    pipelineOrder, setPipelineOrder,
    usePipelineOrder, setUsePipelineOrder,
    stageContextChars, setStageContextChars,
    loadError,
    busy, error, staleAgents, savedAt, save, clearOverride,
  } = useModeRosterState();

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
          {loadError || (error ? `Error: ${error}` : 'Loading modes…')}
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

      <CircuitBreakerBanner tripped={tripped} />
      <ModeTabBar modes={modes} activeTab={activeTab} onSelect={setActiveTab} />
      <OverrideToggle explicit={explicit} available={available} busy={busy}
        onEnable={() => setExplicit(true)} onClear={() => clearOverride(activeTab)} />

      {explicit && (
        <>
          <RosterGrid selected={selected} available={available} isPipeline={isPipeline}
            onAdd={addAgent} onRemove={removeAt} onMove={moveAgent} />
          <ModeOptions activeTab={activeTab} available={available}
            synthesizer={synthesizer} setSynthesizer={setSynthesizer}
            variantPolicy={variantPolicy} setVariantPolicy={setVariantPolicy}
            pipelinePreset={pipelinePreset} setPipelinePreset={setPipelinePreset}
            stageContextChars={stageContextChars} setStageContextChars={setStageContextChars}
            synthesisPolicy={synthesisPolicy} setSynthesisPolicy={setSynthesisPolicy}
            classifierPolicy={classifierPolicy} setClassifierPolicy={setClassifierPolicy}
            maxSelect={maxSelect} setMaxSelect={setMaxSelect} />
          {isPipeline && (
            <PipelineOrderEditor pipelineOrder={pipelineOrder} setPipelineOrder={setPipelineOrder}
              usePipelineOrder={usePipelineOrder} setUsePipelineOrder={setUsePipelineOrder}
              selected={selected} available={available} pipelinePreset={pipelinePreset} />
          )}
          <RosterFooter busy={busy} error={error} staleAgents={staleAgents}
            savedAt={savedAt} onSave={handleSave} />
        </>
      )}
    </div>
  );
}
