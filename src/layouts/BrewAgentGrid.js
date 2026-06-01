import React, { useMemo, useState } from 'react';
import CodeOutputPanel from '../components/CodeOutputPanel';
import { SkeletonAgentCard } from '../components/Skeleton';
import { extractCodeBlock } from '../utils/codeExtractor';
import BrewAgentPopout from './BrewAgentPopout';
import BrewAgentGridRow from './BrewAgentGridRow';

function BrewAgentGrid({
  activeAgents,
  responses,
  loading,
  timings = {},
  flatPickMode = false,
  pickedFlatAgent = null,
  onPickFlatAgent = null,
  agentErrors = {},
  rolesByName = {},
  compact = false,
  onSaveCode = null,
}) {
  const isInitialLoad = loading && Object.keys(responses).length === 0;
  const [popout, setPopout] = useState(null);

  const programmerResp      = responses.programmer;
  const programmerInRoster  = activeAgents.some(({ name }) => name === 'programmer');
  const hasAnyCode = useMemo(
    () => activeAgents.some(({ name }) => {
      const r = responses[name];
      if (!r) return false;
      const { code } = extractCodeBlock(r);
      return code && code.trim().length >= 10;
    }),
    [activeAgents, responses],
  );

  return (
    <>
      <div className={`brew-agent-cards brew-agent-cards--runtime${compact ? ' brew-agent-cards--compact' : ''}`}>
        {isInitialLoad
          ? activeAgents.map(({ name }) => <SkeletonAgentCard key={name} />)
          : activeAgents.map(agent => (
              <BrewAgentGridRow
                key={agent.name}
                agent={agent}
                response={responses[agent.name]}
                err={agentErrors[agent.name]}
                timings={timings[agent.name]}
                loading={loading}
                flatPickMode={flatPickMode}
                pickedFlatAgent={pickedFlatAgent}
                onPickFlatAgent={onPickFlatAgent}
                rolesByName={rolesByName}
                onPopout={setPopout}
              />
            ))}
      </div>

      {(programmerResp || (loading && programmerInRoster)) && (
        <CodeOutputPanel
          sourceText={programmerResp || ''}
          loading={loading}
          onSaveCode={onSaveCode}
          showSave={hasAnyCode}
          sectionClassName="brew-code-output-section--grid"
          editorHeight="min(36vh, 360px)"
        />
      )}

      {popout && (
        <BrewAgentPopout
          name={popout.name}
          model={popout.model}
          meta={popout.meta}
          response={popout.response}
          error={popout.error}
          code={popout.code}
          loading={loading && !!popout.response}
          onClose={() => setPopout(null)}
        />
      )}
    </>
  );
}

export default BrewAgentGrid;
