import React, { useEffect, useMemo, useState } from 'react';
import CodeOutputPanel from '../components/CodeOutputPanel';
import { extractAllCodeBlocks, MIN_CODE_CHARS } from '../utils/codeExtractor';

const EMPTY_HINT =
  'No fenced code block yet — responses need a ```language fence of at least 10 characters.';

function agentHasCode(text) {
  if (!text) return false;
  const blocks = extractAllCodeBlocks(text);
  return blocks.some((b) => b.content.trim().length >= MIN_CODE_CHARS);
}

/**
 * Session-tab CODE OUTPUT — live partial fence, multi-agent source picker (MS-24-2).
 */
export default function BrewCodeResultsPanel({
  responses = {},
  activeAgents = [],
  loading = false,
  onSaveCode,
  onExpandProgrammer = null,
}) {
  const sources = useMemo(() => (
    (activeAgents || [])
      .map(({ name }) => {
        const text = responses[name];
        if (!text && !(loading && name)) return null;
        return { name, text: text || '' };
      })
      .filter(Boolean)
  ), [activeAgents, responses, loading]);

  const codeSources = useMemo(
    () => sources.filter(({ text }) => agentHasCode(text)),
    [sources],
  );

  const [selectedAgent, setSelectedAgent] = useState('programmer');

  useEffect(() => {
    if (codeSources.some(({ name }) => name === selectedAgent)) return;
    const preferred = codeSources.find(({ name }) => name === 'programmer') || codeSources[0];
    if (preferred) setSelectedAgent(preferred.name);
    else if (sources.some(({ name }) => name === 'programmer')) setSelectedAgent('programmer');
    else if (sources[0]) setSelectedAgent(sources[0].name);
  }, [codeSources, sources, selectedAgent]);

  const activeSource = sources.find(({ name }) => name === selectedAgent) || sources[0];
  const hasAnyCode = codeSources.length > 0;

  if (!activeSource) return null;

  const picker = codeSources.length > 1 ? (
    <div className="brew-code-agent-picker" role="tablist" aria-label="Code source agent">
      {codeSources.map(({ name }) => (
        <button
          key={name}
          type="button"
          role="tab"
          aria-selected={selectedAgent === name}
          className={`brew-code-agent-picker-btn${selectedAgent === name ? ' is-active' : ''}`}
          onClick={() => setSelectedAgent(name)}
        >
          {name.toUpperCase()}
        </button>
      ))}
    </div>
  ) : null;

  return (
    <div className="brew-code-results-panel">
      <CodeOutputPanel
        sourceText={activeSource.text}
        loading={loading}
        onSaveCode={onSaveCode}
        onExpandProgrammer={onExpandProgrammer}
        showSave={hasAnyCode}
        sectionClassName="brew-code-output-section--session"
        emptyHint={EMPTY_HINT}
        editorHeight="min(42vh, 420px)"
        headerExtra={picker}
      />
    </div>
  );
}
