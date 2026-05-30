import React, { useCallback } from 'react';
import BrewAgentCard, { modelShortName } from './BrewAgentCard';
import AgentMarkdown from '../components/AgentMarkdown';
import CodeDisplay from '../components/CodeDisplay';
import { SkeletonAgentCard } from '../components/Skeleton';
import { extractCodeBlock } from '../utils/codeExtractor';

const ENGINE_LABELS = { llama: 'LLAMA', mlx: 'MLX', vllm: 'vLLM', docker: 'DOCKER' };

function buildMeta(agent, timings, agentError, loading, hasResponse, ctx) {
  if (agentError) return 'Status: FAILED';
  if (loading && !hasResponse) return 'Status: BREWING…';
  if (hasResponse && timings?.total_ms != null) {
    const eng = timings.gpu_pct != null
      ? `GPU ${Math.round(timings.gpu_pct)}%`
      : (ENGINE_LABELS[agent.engine || agent.backend] || 'LLAMA');
    let line = `${eng} • ${(timings.total_ms / 1000).toFixed(1)}s`;
    if (ctx > 0) line += ` • Context ${ctx.toLocaleString()}`;
    return line;
  }
  const eng = ENGINE_LABELS[agent.engine || agent.backend] || agent.engine || '—';
  let line = `${eng} • :${agent.port ?? '—'}`;
  if (ctx > 0) line += ` • Context ${ctx.toLocaleString()}`;
  return line;
}

function BrewAgentGrid({
  activeAgents,
  responses,
  loading,
  timings = {},
  onSaveCode,
  flatPickMode = false,
  pickedFlatAgent = null,
  onPickFlatAgent = null,
  agentErrors = {},
  rolesByName = {},
  compact = false,
}) {
  const isInitialLoad = loading && Object.keys(responses).length === 0;

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

  const renderCard = useCallback((agent) => {
    const { name, model, backend, engine } = agent;
    const response = responses[name];
    const err = agentErrors[name];
    const isPicked = flatPickMode && pickedFlatAgent === name;
    const isPickable = flatPickMode && response && !loading;
    const role = rolesByName[name];
    const ctx = role?.context;
    const meta = buildMeta(agent, timings[name], err, loading, !!response, ctx);

    return (
      <BrewAgentCard
        key={name}
        name={name.toUpperCase()}
        model={modelShortName(model)}
        meta={meta}
        picked={isPicked}
        pickable={isPickable}
        onClick={isPickable ? () => onPickFlatAgent(name) : undefined}
        className="brew-agent-card--runtime"
      >
        {err ? (
          <div className="brew-agent-response brew-agent-response--error">
            <span className="brew-agent-response-error-icon">✕</span>
            {err}
          </div>
        ) : loading && !response ? (
          <div className="brew-agent-response brew-agent-response--loading">
            <span className="brew-agent-response-dot">.</span>
            <span className="brew-agent-response-dot">.</span>
            <span className="brew-agent-response-dot">.</span>
          </div>
        ) : response ? (
          <div className="brew-agent-response">
            <AgentMarkdown text={response} />
          </div>
        ) : (
          <div className="brew-agent-response brew-agent-response--idle">
            Awaiting broadcast…
          </div>
        )}
      </BrewAgentCard>
    );
  }, [responses, loading, timings, flatPickMode, pickedFlatAgent, onPickFlatAgent, agentErrors, rolesByName]);

  return (
    <>
      <div className={`brew-agent-cards brew-agent-cards--runtime${compact ? ' brew-agent-cards--compact' : ''}`}>
        {isInitialLoad
          ? activeAgents.map(({ name }) => <SkeletonAgentCard key={name} />)
          : activeAgents.map(renderCard)}
      </div>

      {programmerResp && (
        <div className="brew-code-output-section">
          <div className="brew-code-output-header">
            <span className="brew-section-title">CODE OUTPUT</span>
            {hasAnyCode && (
              <button type="button" className="brew-agent-card-edit" onClick={onSaveCode}>
                SAVE
              </button>
            )}
          </div>
          <div className="brew-code-output-frame">
            <CodeDisplay initialCode={code} language={language} />
          </div>
        </div>
      )}
    </>
  );
}

export default BrewAgentGrid;
