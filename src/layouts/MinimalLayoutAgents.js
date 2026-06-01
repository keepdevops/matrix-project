import React, { useState } from 'react';
import AgentGrid from '../components/AgentGrid';
import HelpModal from '../components/HelpModal';
import RagAdmin from '../components/RagAdmin';
import CachePanel from '../components/CachePanel';

const EXPAND_PROGRAMMER_OPTS = {
  followup: true,
  contextPolicy: {
    include: ['original_prompt', 'final', 'programmer'],
    target_agent: 'programmer',
    max_context_chars: 24000,
  },
};

export default function MinimalLayoutAgents({
  activeAgents, responses, loading, lastMeta,
  activeMode, flatPickAgent, onPickFlatAgent, onSaveCode, onSubmit,
  showHelp, showRagAdmin, showCachePanel,
  onOpenHelp, onOpenRagAdmin, onOpenCachePanel,
}) {
  const [showAgents, setShowAgents] = useState(false);
  const agentCount = Object.keys(responses).length;

  return (
    <>
      {agentCount > 0 && (
        <div className="ml-agents-toggle">
          <button className="ml-agents-btn" onClick={() => setShowAgents(v => !v)}>
            {showAgents ? '▲ Hide' : '▼ Show'} agent responses ({agentCount})
          </button>
        </div>
      )}

      {showAgents && (
        <div className="ml-agents-panel">
          <AgentGrid
            activeAgents={activeAgents} responses={responses}
            loading={loading} timings={lastMeta?.timings || {}}
            onSaveCode={onSaveCode}
            flatPickMode={activeMode === 'flat'}
            pickedFlatAgent={flatPickAgent}
            onPickFlatAgent={onPickFlatAgent}
            onExpandProgrammer={(instruction) => onSubmit(instruction, 0.2, EXPAND_PROGRAMMER_OPTS)}
          />
        </div>
      )}

      {showHelp      && <HelpModal onClose={onOpenHelp} />}
      {showRagAdmin  && <RagAdmin onClose={onOpenRagAdmin} />}
      {showCachePanel && <CachePanel onClose={onOpenCachePanel} />}
    </>
  );
}
