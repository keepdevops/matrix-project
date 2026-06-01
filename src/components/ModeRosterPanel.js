import React from 'react';
import Button from './Button';
import RosterGrid from './RosterGrid';
import PipelineOrderEditor from './PipelineOrderEditor';
import ModeOptions from './ModeOptions';
import { useModeRosterPanel } from './useModeRosterPanel';

export default function ModeRosterPanel() {
  const {
    modes, activeTab, setActiveTab, available, selected, explicit, setExplicit,
    synthesizer, setSynthesizer, variantPolicy, setVariantPolicy,
    pipelinePreset, setPipelinePreset, synthesisPolicy, setSynthesisPolicy,
    classifierPolicy, setClassifierPolicy, pipelineOrder, setPipelineOrder,
    usePipelineOrder, setUsePipelineOrder, stageContextChars, setStageContextChars,
    maxSelect, setMaxSelect, loadError, tripped, busy, error, staleAgents, savedAt,
    clearOverride, isPipeline, addAgent, removeAt, moveAgent, handleSave,
  } = useModeRosterPanel();

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

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
        <button
          type="button"
          role="switch"
          aria-checked={explicit}
          className={`brew-perm-toggle${explicit ? ' on' : ''}`}
          onClick={() => {
            if (explicit) {
              clearOverride(activeTab);
            } else {
              setExplicit(true);
            }
          }}
          disabled={busy}
          style={{ flexShrink: 0 }}
        >
          <span className="brew-perm-thumb" />
        </button>
        <span style={{ fontSize: '0.8rem', opacity: explicit ? 1 : 0.6 }}>
          {explicit
            ? `Override ON — custom roster active`
            : `Override OFF — using full roster (${available.length} agent${available.length === 1 ? '' : 's'})`}
        </span>
      </div>

      {explicit && (
        <>
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
        </>
      )}
    </div>
  );
}
