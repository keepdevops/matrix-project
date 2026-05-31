import React, { useState, useRef, useEffect } from 'react';
import SwarmEditor from './SwarmEditor';
import { normalizeLanguage } from '../utils/codeExtractor';
import Button from './Button';

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
  const [isEditable, setIsEditable] = useState(false);
  const [editedCode, setEditedCode] = useState(controlledCode ?? initialCode ?? '');
  const [copyFeedback, setCopyFeedback] = useState('COPY');
  const fileInputRef = useRef(null);
  const copyTimerRef = useRef(null);
  const editorWrapRef = useRef(null);

  const language = normalizeLanguage(rawLanguage);
  const incoming = controlledCode !== undefined ? controlledCode : initialCode;

  useEffect(() => {
    if (isEditable) return;
    setEditedCode(incoming ?? '');
  }, [incoming, isEditable]);

  useEffect(() => {
    if (isStreaming) setIsEditable(false);
  }, [isStreaming]);

  useEffect(() => {
    if (!isStreaming || !autoScroll) return;
    const scroller = editorWrapRef.current?.querySelector('.cm-scroller');
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }, [editedCode, isStreaming, autoScroll]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(editedCode);
      setCopyFeedback('COPIED!');
      clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopyFeedback('COPY'), 2000);
    } catch (err) {
      console.error('[CodeDisplay] clipboard write failed:', err);
      setCopyFeedback('FAILED');
      clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopyFeedback('COPY'), 2000);
    }
  };

  const handleSave = () => {
    const extensionMap = { python: 'py', javascript: 'js', cpp: 'cpp', rust: 'rs', json: 'json' };
    const ext = extensionMap[language] || 'txt';
    const blob = new Blob([editedCode], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `swarm_export_${Date.now()}.${ext}`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleFileOpen = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      setEditedCode(event.target.result);
      setIsEditable(true);
    };
    reader.onerror = () => {
      console.error('[CodeDisplay] FileReader failed to read:', file.name);
    };
    reader.readAsText(file);
  };

  const toggleAutoScroll = () => {
    const next = !autoScroll;
    onAutoScrollChange?.(next);
  };

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
            <Button
              variant="ghost"
              size="xs"
              className={autoScroll ? 'active' : ''}
              onClick={toggleAutoScroll}
            >
              {autoScroll ? '⇳ SCROLL' : 'SCROLL OFF'}
            </Button>
          )}

          <Button
            variant="ghost"
            size="xs"
            className={isEditable ? 'active' : ''}
            onClick={() => setIsEditable(!isEditable)}
            disabled={isStreaming}
          >
            {isEditable ? '🔒 LOCK' : '📝 EDIT'}
          </Button>

          <Button variant="ghost" size="xs" onClick={handleCopy}>
            {copyFeedback === 'COPIED!' ? '✅ ' : '📋 '}{copyFeedback}
          </Button>

          <Button variant="ghost" size="xs" onClick={handleSave}>
            💾 SAVE
          </Button>

          <Button variant="ghost" size="xs" onClick={() => fileInputRef.current?.click()}>
            📂 OPEN
          </Button>
        </div>
      </header>

      <input
        type="file"
        ref={fileInputRef}
        style={{ display: 'none' }}
        onChange={handleFileOpen}
      />

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
