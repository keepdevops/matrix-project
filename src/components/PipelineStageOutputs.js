import React from 'react';

export default function PipelineStageOutputs({ stageOutputs }) {
  if (!stageOutputs || stageOutputs.length === 0) return null;
  return (
    <div className="final-answer-panel" style={{ marginTop: '0.75rem' }}>
      <div className="swarm-config-title">PIPELINE STAGE OUTPUTS</div>
      {stageOutputs.map((stage, idx) => (
        <details key={idx} style={{ marginTop: '0.4rem' }}>
          <summary>{stage.step}. {stage.agent}</summary>
          <pre style={{ whiteSpace: 'pre-wrap', marginTop: '0.4rem' }}>{stage.output}</pre>
        </details>
      ))}
    </div>
  );
}
