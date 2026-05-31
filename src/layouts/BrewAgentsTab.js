import React from 'react';
import BrewAgentGrid from './BrewAgentGrid';
import CompareVariantsPanel from '../components/CompareVariantsPanel';

export default function BrewAgentsTab({
  activeAgents, responses, agentErrors, loading, lastMeta,
  activeMode, flatPickAgent, rolesByName,
  onPickFlatAgent, onSaveCode, onSendBestContinue,
}) {
  return (
    <div className="brew-agents-tab">
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
      />
      {activeMode === 'flat' && Object.keys(responses).length > 0 && (
        <CompareVariantsPanel
          activeAgents={activeAgents}
          responses={responses}
          loading={loading}
          flatPickAgent={flatPickAgent}
          onPickAgent={onPickFlatAgent}
          onSendBest={() => onSendBestContinue(0.2)}
        />
      )}
    </div>
  );
}
