import React from 'react';
import BrewAgentGrid from './BrewAgentGrid';
import PipelineStageOutputs from '../components/PipelineStageOutputs';
import MetricsStrip from '../components/MetricsStrip';

function PhaseLabel({ phase }) {
  if (!phase) return null;
  const parts = [phase.agent && `agent: ${phase.agent}`];
  if (phase.depth !== undefined) parts.push(`depth ${phase.depth + 1}`);
  if (phase.round !== undefined) parts.push(`round ${phase.round}`);
  if (phase.role) parts.push(phase.role);
  const label = parts.filter(Boolean).join(' · ');
  if (!label) return null;
  return (
    <span className="brew-brewcast-phase" style={{ marginLeft: '0.75rem', opacity: 0.7, fontSize: '0.72rem' }}>
      {label}
    </span>
  );
}

export default function BrewBroadcastTab({
  activeAgents, responses, agentErrors, loading, lastMeta, stageOutputs,
  activeMode, flatPickAgent, rolesByName, onPickFlatAgent, onSaveCode,
}) {
  return (
    <div className="brew-brewcast-panel">
      {!lastMeta && !loading && (
        <div className="brew-chat-empty">
          <span className="brew-chat-empty-icon">📡</span>
          <span>No broadcast yet — run a prompt first</span>
        </div>
      )}
      {loading && (
        <div className="brew-brewcast-live">
          <span className="brew-brewcast-dot" />
          <span className="brew-brewcast-live-label">LIVE</span>
          <PhaseLabel phase={lastMeta?._phase} />
        </div>
      )}
      {(loading || lastMeta) && (
        <div className="brew-brewcast-agents">
          <BrewAgentGrid
            activeAgents={activeAgents}
            responses={responses}
            agentErrors={agentErrors}
            loading={loading}
            timings={lastMeta?.timings || {}}
            flatPickMode={activeMode === 'flat'}
            pickedFlatAgent={flatPickAgent}
            onPickFlatAgent={onPickFlatAgent}
            onSaveCode={onSaveCode}
            rolesByName={rolesByName}
            compact
          />
        </div>
      )}
      {lastMeta && (
        <>
          <div className="brew-brewcast-section-title">Pipeline Stages</div>
          <PipelineStageOutputs stageOutputs={stageOutputs} />
          <div className="brew-brewcast-section-title" style={{ marginTop: '0.75rem' }}>Agent Timings</div>
          <MetricsStrip envelope={{ meta: lastMeta }} />
        </>
      )}
    </div>
  );
}
