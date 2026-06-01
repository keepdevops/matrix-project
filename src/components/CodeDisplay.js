import React from 'react';
import SwarmEditor from './SwarmEditor';
import Button from './Button';
import { useCodeDisplay } from './useCodeDisplay';

const CodeDisplay = ({
  initialCode,
  code: controlledCode,
  language: rawLanguage,
  editorHeight = '400px',
  isStreaming = false,
  isPartial = false,
  autoScroll = true,
  onAutoScrollChange = null,
}) => {
  const {
    language, isEditable, setIsEditable, editedCode, setEditedCode,
    copyFeedback, fileInputRef, editorWrapRef,
    handleCopy, handleSave, handleFileOpen, toggleAutoScroll,
  } = useCodeDisplay({ initialCode, code: controlledCode, language: rawLanguage, isStreaming, autoScroll, onAutoScrollChange });

  return (
    <div className={`code-display-container${isStreaming ? ' code-display-container--streaming' : ''}`}>
      <header className="code-display-header">
        <div className="code-lang-tag">
          <span className={`pulse-dot${isStreaming ? ' pulse-dot--live' : ''}`} />
          {language.toUpperCase()}
          {isStreaming && (
            <span className="code-streaming-badge">{isPartial ? 'streaming…' : 'generating…'}</span>
          )}
        </div>

        <div className="code-toolbar">
          {isStreaming && onAutoScrollChange && (
            <Button variant="ghost" size="xs" className={autoScroll ? 'active' : ''} onClick={toggleAutoScroll}>
              {autoScroll ? '⇳ SCROLL' : 'SCROLL OFF'}
            </Button>
          )}
          <Button variant="ghost" size="xs" className={isEditable ? 'active' : ''}
            onClick={() => setIsEditable(!isEditable)} disabled={isStreaming}>
            {isEditable ? '🔒 LOCK' : '📝 EDIT'}
          </Button>
          <Button variant="ghost" size="xs" onClick={handleCopy}>
            {copyFeedback === 'COPIED!' ? '✅ ' : '📋 '}{copyFeedback}
          </Button>
          <Button variant="ghost" size="xs" onClick={handleSave}>💾 SAVE</Button>
          <Button variant="ghost" size="xs" onClick={() => fileInputRef.current?.click()}>📂 OPEN</Button>
        </div>
      </header>

      <input type="file" ref={fileInputRef} style={{ display: 'none' }} onChange={handleFileOpen} />

      <div ref={editorWrapRef} className="code-display-editor-wrap">
        <SwarmEditor
          code={editedCode}
          language={language}
          editable={isEditable && !isStreaming}
          onChange={(val) => setEditedCode(val)}
          height={editorHeight}
        />
      </div>
    </div>
  );
};

export default CodeDisplay;
