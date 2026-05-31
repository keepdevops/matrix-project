import React, { useCallback } from 'react';
import AgentResponse from './AgentResponse';
import CodeOutputPanel from './CodeOutputPanel';
import { SkeletonAgentCard } from './Skeleton';
import { getAgentColor } from '../utils/agentColors';
import { extractCodeBlock, hasExtractableCode } from '../utils/codeExtractor';

const ENGINE_LABELS = { llama: 'LLAMA', mlx: 'MLX', vllm: 'vLLM', docker: 'DOCKER' };
const modelDisplayName = (m) => {
  if (!m) return null;
  const s = String(m);
  return s.includes('/') ? s.split('/').pop() : s;
};

function AgentGrid({ activeAgents, responses, loading, timings = {}, onSaveCode,
                     onExpandProgrammer = null,
                     flatPickMode = false, pickedFlatAgent = null, onPickFlatAgent = null,
                     agentErrors = {} }) {
  // Show skeleton cards while the first submission is in flight (no responses yet).
  const isInitialLoad = loading && Object.keys(responses).length === 0;

  const hasAnyCode = activeAgents.some(({ name }) => {
    const r = responses[name];
    if (!r) return false;
    const { code } = extractCodeBlock(r);
    return code && code.trim().length >= 10;
  });

  const programmerResp = responses.programmer;
  const programmerInRoster = activeAgents.some(({ name }) => name === 'programmer');

  const renderCard = useCallback(({ name, port, model, backend, engine }) => {
    const isPicked = flatPickMode && pickedFlatAgent === name;
    const isPickable = flatPickMode && responses[name] && !loading;
    return (
      <AgentResponse
        key={name}
        name={name.toUpperCase()}
        port={String(port)}
        response={responses[name] || null}
        color={getAgentColor(name)}
        loading={loading}
        model={modelDisplayName(model)}
        engine={ENGINE_LABELS[backend || engine] || backend || engine || null}
        tokenStats={timings[name] || null}
        picked={isPicked}
        pickable={isPickable}
        onPick={isPickable ? () => onPickFlatAgent(name) : null}
        agentError={agentErrors[name] || null}
        hasCode={hasExtractableCode(responses[name])}
      />
    );
  }, [responses, loading, timings, flatPickMode, pickedFlatAgent, onPickFlatAgent, agentErrors]);

  return (
    <>
      <div className="agents-grid">
        {isInitialLoad
          ? activeAgents.map(({ name }) => <SkeletonAgentCard key={name} />)
          : activeAgents.map(renderCard)}
      </div>

      {(programmerResp || (loading && programmerInRoster)) && (
        <div className="code-output-section">
          <CodeOutputPanel
            sourceText={programmerResp || ''}
            loading={loading}
            onSaveCode={onSaveCode}
            onExpandProgrammer={onExpandProgrammer}
            showSave={hasAnyCode}
            frameClassName="editor-frame"
            editorHeight="min(42vh, 420px)"
          />
        </div>
      )}
    </>
  );
}

export default AgentGrid;
