import React, { useState, useRef, useEffect } from 'react';
import SwarmEditor from './SwarmEditor';
import { normalizeLanguage } from '../utils/codeExtractor';

const CodeDisplay = ({ initialCode, language: rawLanguage }) => {
  const [isEditable, setIsEditable] = useState(false);
  const [editedCode, setEditedCode] = useState(initialCode);
  const [copyFeedback, setCopyFeedback] = useState('COPY');
  const fileInputRef = useRef(null);

  // Normalize language for file extensions and highlighting
  const language = normalizeLanguage(rawLanguage);

  // Reset internal state if the agent sends a completely new response
  useEffect(() => {
    setEditedCode(initialCode);
    setIsEditable(false);
  }, [initialCode]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(editedCode);
      setCopyFeedback('COPIED!');
      setTimeout(() => setCopyFeedback('COPY'), 2000);
    } catch (err) {
      console.error('Copy failed', err);
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
      setIsEditable(true); // Auto-enable edit mode when a file is loaded
    };
    reader.readAsText(file);
  };

  return (
    <div className="code-display-container">
      <header className="code-display-header">
        <div className="code-lang-tag">
          <span className="pulse-dot"></span> {language.toUpperCase()}
        </div>

        <div className="code-toolbar">
          <button
            className={`toolbar-btn ${isEditable ? 'active' : ''}`}
            onClick={() => setIsEditable(!isEditable)}
          >
            {isEditable ? '🔒 LOCK' : '📝 EDIT'}
          </button>

          <button className="toolbar-btn" onClick={handleCopy}>
            {copyFeedback === 'COPIED!' ? '✅ ' : '📋 '}{copyFeedback}
          </button>

          <button className="toolbar-btn" onClick={handleSave}>
            💾 SAVE
          </button>

          <button className="toolbar-btn" onClick={() => fileInputRef.current?.click()}>
            📂 OPEN
          </button>
        </div>
      </header>

      {/* Hidden File Input */}
      <input
        type="file"
        ref={fileInputRef}
        style={{ display: 'none' }}
        onChange={handleFileOpen}
      />

      <SwarmEditor
        code={editedCode}
        language={language}
        editable={isEditable}
        onChange={(val) => setEditedCode(val)}
      />
    </div>
  );
};

export default CodeDisplay;
