import React from 'react';
import Button from './Button';
import CodeDisplay from './CodeDisplay';
import { extractCodeBlock } from '../utils/codeExtractor';

export default function AgentEditorModal({ agentName, response, color, onClose, onSave }) {
  const { code, language } = extractCodeBlock(response || '');
  const content = code || response || '';

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const handleSave = (updatedCode) => {
    if (onSave) {
      onSave(updatedCode);
    }
    onClose();
  };

  return (
    <div className="help-overlay" onClick={handleBackdropClick}>
      <div className="agent-editor-modal" style={{ '--agent-color': color }}>
        <div className="agent-editor-modal-header">
          <span className="agent-editor-modal-name">{agentName.toUpperCase()}</span>
          <Button variant="ghost" size="xs" className="agent-editor-close" onClick={onClose}>✕</Button>
        </div>
        <div className="agent-editor-modal-content">
          <CodeDisplay
            initialCode={content}
            language={language}
            onSave={handleSave}
          />
        </div>
      </div>
    </div>
  );
}
