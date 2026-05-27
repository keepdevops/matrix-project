import React from 'react';
import Button from './Button';

function presetStageOrder(preset, agentNames) {
  const avail = new Set(agentNames);
  const push = (out, n) => { if (avail.has(n)) out.push(n); };
  const out = [];
  if (preset === 'code-quality') {
    push(out, 'architect'); push(out, 'programmer');
    push(out, 'tester');    push(out, 'programmer');
  } else if (preset === 'debug-fix') {
    push(out, 'tester'); push(out, 'programmer'); push(out, 'tester');
  } else if (preset === 'docs-finalize') {
    push(out, 'programmer'); push(out, 'documenter');
  }
  return out;
}

export default function PipelineOrderEditor({
  pipelineOrder, setPipelineOrder,
  usePipelineOrder, setUsePipelineOrder,
  selected, available, pipelinePreset,
}) {
  const moveStage = (i, dir) => setPipelineOrder(prev => {
    const n = [...prev];
    [n[i + dir], n[i]] = [n[i], n[i + dir]];
    return n;
  });

  return (
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
            Stages run in this sequence. Names must be deployed; duplicates allowed.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', marginTop: '0.35rem' }}>
            {pipelineOrder.length === 0 && (
              <span style={{ opacity: 0.55 }}>— empty — add stages below or apply preset</span>
            )}
            {pipelineOrder.map((name, i) => (
              <div key={`${name}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <span style={{ opacity: 0.55, width: '1.5rem' }}>{i + 1}.</span>
                <span style={{ flex: 1 }}>{name}</span>
                <Button variant="ghost" size="xs" type="button"
                        disabled={i === 0} onClick={() => moveStage(i, -1)}>↑</Button>
                <Button variant="ghost" size="xs" type="button"
                        disabled={i === pipelineOrder.length - 1} onClick={() => moveStage(i, 1)}>↓</Button>
                <Button variant="ghost" size="xs" type="button"
                        onClick={() => setPipelineOrder(prev => prev.filter((_, j) => j !== i))}>✕</Button>
              </div>
            ))}
          </div>
          <div style={{ marginTop: '0.45rem', display: 'flex', flexWrap: 'wrap', gap: '0.35rem', alignItems: 'center' }}>
            <span>Add stage:</span>
            <select defaultValue=""
              onChange={e => {
                const v = e.target.value;
                if (v) { setPipelineOrder(prev => [...prev, v]); e.target.value = ''; }
              }}
              style={{ padding: '0.15rem 0.3rem' }}
            >
              <option value="">— role —</option>
              {available.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            <Button
              variant="outline-primary"
              size="sm"
              type="button"
              disabled={!pipelinePreset}
              onClick={() => {
                setPipelineOrder(presetStageOrder(pipelinePreset, available));
                setUsePipelineOrder(true);
              }}
            >
              Apply preset to stage order
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
