import React from 'react';
import AgentResponse from './AgentResponse';
import CodeDisplay from './CodeDisplay';
import { getAgentColor } from '../utils/agentColors';
import { extractCodeBlock } from '../utils/codeExtractor';

const ENGINE_LABELS = { llama: 'LLAMA', mlx: 'MLX', vllm: 'vLLM', docker: 'DOCKER' };
const modelDisplayName = (m) => {
  if (!m) return null;
  const s = String(m);
  return s.includes('/') ? s.split('/').pop() : s;
};

function AgentGrid({ activeAgents, responses, loading, onSaveCode,
                     flatPickMode = false, pickedFlatAgent = null, onPickFlatAgent = null }) {
  const hasAnyCode = activeAgents.some(({ name }) => {
    const r = responses[name];
    if (!r) return false;
    const { code } = extractCodeBlock(r);
    return code && code.trim().length >= 10;
  });

  const programmerResp = responses.programmer;
  const { code, language } = programmerResp
    ? extractCodeBlock(programmerResp)
    : { code: null, language: null };

  const renderCard = ({ name, port, model, backend, engine }) => {
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
        picked={isPicked}
        pickable={isPickable}
        onPick={isPickable ? () => onPickFlatAgent(name) : null}
      />
    );
  };

  return (
    <>
      <div className="agents-grid">
        {activeAgents.map(renderCard)}
      </div>

      {programmerResp && (
        <div className="code-output-section">
          <div className="code-output-header">
            <h2 className="section-title">CODE OUTPUT</h2>
            {hasAnyCode && (
              <button className="save-code-btn" onClick={onSaveCode}>
                SAVE CODE
              </button>
            )}
          </div>
          <div className="editor-frame">
            <CodeDisplay initialCode={code} language={language} />
          </div>
        </div>
      )}
    </>
  );
}

export default AgentGrid;
