import React from 'react';
import BrewAgentCard, { modelShortName } from './BrewAgentCard';
import AgentMarkdown from '../components/AgentMarkdown';
import CodeOutputPanel from '../components/CodeOutputPanel';
import { extractCodeBlock, hasExtractableCode } from '../utils/codeExtractor';

const ENGINE_LABELS = { llama: 'LLAMA', mlx: 'MLX', vllm: 'vLLM', docker: 'DOCKER' };

export function buildMeta(agent, timings, agentError, loading, hasResponse, ctx) {
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

export default function BrewAgentGridRow({
  agent, response, err, timings, loading,
  flatPickMode, pickedFlatAgent, onPickFlatAgent,
  rolesByName, onPopout,
}) {
  const { name, model } = agent;
  const isPicked  = flatPickMode && pickedFlatAgent === name;
  const isPickable = flatPickMode && response && !loading;
  const ctx  = rolesByName[name]?.context;
  const meta = buildMeta(agent, timings, err, loading, !!response, ctx);

  const { code, language } = response
    ? extractCodeBlock(response) : { code: null, language: null };
  const hasCode       = code && code.trim().length >= 10;
  const showInlineCode = Boolean(response && (hasCode || loading));

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
      hasCode={hasExtractableCode(response)}
    >
      {err ? (
        <div className="brew-agent-response brew-agent-response--error">
          <span className="brew-agent-response-error-icon">✕</span>
          {err}
          <button
            type="button"
            className="brew-agent-card-edit"
            style={{ marginLeft: 'auto', flexShrink: 0 }}
            onClick={e => { e.stopPropagation(); onPopout({ name, model: modelShortName(model), meta, response: null, error: err, code: null, language: null }); }}
            title="Popout"
          >⤢</button>
        </div>
      ) : loading && !response ? (
        <div className="brew-agent-response brew-agent-response--loading">
          <span className="brew-agent-response-dot">.</span>
          <span className="brew-agent-response-dot">.</span>
          <span className="brew-agent-response-dot">.</span>
        </div>
      ) : response ? (
        <>
          <div className="brew-agent-response" style={{ position: 'relative' }}>
            <AgentMarkdown text={response} />
            <button
              type="button"
              className="brew-agent-card-edit"
              style={{ position: 'absolute', top: 0, right: 0 }}
              onClick={e => { e.stopPropagation(); onPopout({ name, model: modelShortName(model), meta, response, error: null, code: hasCode ? code : null, language }); }}
              title="Popout"
            >⤢</button>
          </div>
          {showInlineCode && (
            <CodeOutputPanel
              sourceText={response}
              loading={loading}
              editorHeight="220px"
              sectionClassName="brew-code-output-section--card"
            />
          )}
        </>
      ) : (
        <div className="brew-agent-response brew-agent-response--idle">
          Awaiting broadcast…
        </div>
      )}
    </BrewAgentCard>
  );
}
