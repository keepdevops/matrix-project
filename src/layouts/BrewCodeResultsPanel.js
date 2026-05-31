import React, { useMemo } from 'react';
import CodeOutputPanel from '../components/CodeOutputPanel';
import { extractCodeBlock } from '../utils/codeExtractor';

const EMPTY_HINT =
  'No fenced code block yet — programmer responses need a ```language fence of at least 10 characters.';

/**
 * Programmer CODE OUTPUT on Session tab — live partial fence while streaming.
 */
export default function BrewCodeResultsPanel({
  responses = {},
  activeAgents = [],
  loading = false,
  onSaveCode,
}) {
  const programmerInRoster = (activeAgents || []).some(({ name }) => name === 'programmer');
  const programmerResp = responses.programmer;

  const hasAnyCode = useMemo(
    () => (activeAgents || []).some(({ name }) => {
      const r = responses[name];
      if (!r) return false;
      const { code } = extractCodeBlock(r);
      return code && code.trim().length >= 10;
    }),
    [activeAgents, responses],
  );

  if (!programmerResp && !(loading && programmerInRoster)) return null;

  return (
    <div className="brew-code-results-panel">
      <CodeOutputPanel
        sourceText={programmerResp || ''}
        loading={loading}
        onSaveCode={onSaveCode}
        showSave={hasAnyCode}
        sectionClassName="brew-code-output-section--session"
        emptyHint={EMPTY_HINT}
        editorHeight="min(42vh, 420px)"
      />
    </div>
  );
}
