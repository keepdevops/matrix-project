import React, { useCallback, useMemo, useState } from 'react';
import BrewAgentCard, { modelShortName } from './BrewAgentCard';
import AgentMarkdown from '../components/AgentMarkdown';
import CodeOutputPanel from '../components/CodeOutputPanel';
import { SkeletonAgentCard } from '../components/Skeleton';
import { extractCodeBlock } from '../utils/codeExtractor';
import BrewAgentPopout from './BrewAgentPopout';

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

  const programmerResp = responses.programmer;
  const programmerInRoster = activeAgents.some(({ name }) => name === 'programmer');
  const hasAnyCode = useMemo(
    () => activeAgents.some(({ name }) => {
      const r = responses[name];
      if (!r) return false;
      const { code } = extractCodeBlock(r);
      return code && code.trim().length >= 10;
    }),
    [activeAgents, responses],
  );

  const renderCard = useCallback((agent) => {
    const { name, model } = agent;
    const response = responses[name];
    const err = agentErrors[name];
    const isPicked = flatPickMode && pickedFlatAgent === name;
    const isPickable = flatPickMode && response && !loading;
    const role = rolesByName[name];
    const ctx = role?.context;
    const meta = buildMeta(agent, timings[name], err, loading, !!response, ctx);

    const { code, language } = response ? extractCodeBlock(response) : { code: null, language: null };
    const hasCode = code && code.trim().length >= 10;
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
      >
        {err ? (
          <div className="brew-agent-response brew-agent-response--error">
            <span className="brew-agent-response-error-icon">✕</span>
            {err}
            <button
              type="button"
              className="brew-agent-card-edit"
              style={{ marginLeft: 'auto', flexShrink: 0 }}
              onClick={e => { e.stopPropagation(); setPopout({ name, model: modelShortName(model), meta, response: null, error: err, code: null, language: null }); }}
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
                onClick={e => { e.stopPropagation(); setPopout({ name, model: modelShortName(model), meta, response, error: null, code: hasCode ? code : null, language }); }}
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
  }, [responses, loading, timings, flatPickMode, pickedFlatAgent, onPickFlatAgent, agentErrors, rolesByName]);

  return (
    <>
      <div className={`brew-agent-cards brew-agent-cards--runtime${compact ? ' brew-agent-cards--compact' : ''}`}>
        {isInitialLoad
          ? activeAgents.map(({ name }) => <SkeletonAgentCard key={name} />)
          : activeAgents.map(renderCard)}
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
