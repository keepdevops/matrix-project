import React, { useState } from 'react';
import Button from './Button';
import CodeDisplay from './CodeDisplay';
import { useLiveCodeExtraction } from '../hooks/useLiveCodeExtraction';

/**
 * CODE OUTPUT block with live partial-fence updates during BREWING.
 */
export default function CodeOutputPanel({
  sourceText,
  loading = false,
  onSaveCode = null,
  showSave = false,
  editorHeight = '400px',
  sectionClassName = '',
  frameClassName = '',
  emptyHint = null,
  title = 'CODE OUTPUT',
}) {
  const live = useLiveCodeExtraction(sourceText, loading);
  const [autoScroll, setAutoScroll] = useState(true);

  const showHint = !live.hasCode && !live.isStreaming && emptyHint;
  const showSaveBtn = showSave && onSaveCode && (live.hasCompleteCode || live.hasCode);

  return (
    <div className={`brew-code-output-section ${sectionClassName}`.trim()}>
      <div className="brew-code-output-header">
        <span className="brew-section-title">{title}</span>
        {showSaveBtn && (
          <Button variant="outline-primary" size="xs" onClick={onSaveCode}>
            SAVE CODE
          </Button>
        )}
      </div>
      <div className={`brew-code-output-frame ${frameClassName}`.trim()}>
        <CodeDisplay
          code={live.code}
          language={live.language}
          isStreaming={live.isStreaming}
          isPartial={live.isPartial}
          autoScroll={autoScroll}
          onAutoScrollChange={setAutoScroll}
          editorHeight={editorHeight}
        />
      </div>
      {showHint && <p className="brew-code-results-hint">{emptyHint}</p>}
    </div>
  );
}
