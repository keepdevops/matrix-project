import React, { useState } from 'react';
import AgentEditorModal from './AgentEditorModal';

function AgentResponse({ name, response, color = '#00ff41', loading = false, port, model, engine }) {
  const [showModal, setShowModal] = useState(false);

  const getStatusClass = () => {
    if (loading) return 'status-loading';
    if (response) return 'status-ready';
    return 'status-idle';
  };

  const getStatusText = () => {
    if (loading) return 'PROCESSING';
    if (response) return 'COMPLETE';
    return 'READY';
  };

  return (
    <>
      <div className="agent-response" style={{ '--agent-color': color }}>
        <div className="agent-header">
          <span className="agent-name">{name}</span>
          {port && <span className="agent-port">({port})</span>}
          <span className={`agent-status ${getStatusClass()}`}>
            {getStatusText()}
          </span>
          {response && (
            <button
              className="agent-expand-btn"
              onClick={() => setShowModal(true)}
              title="Open in editor"
            >
              ⤢
            </button>
          )}
        </div>
        {(model || engine) && (
          <div className="agent-meta">
            <span className="agent-meta-item">MODEL: {model || '—'}</span>
            <span className="agent-meta-item">ENGINE: {engine || '—'}</span>
          </div>
        )}
        <div className="agent-content">
          {loading ? (
            <div className="loading-spinner">
              <span className="spinner-dot">.</span>
              <span className="spinner-dot">.</span>
              <span className="spinner-dot">.</span>
            </div>
          ) : response ? (
            <pre className="response-text">{response}</pre>
          ) : (
            <span className="idle-text">Awaiting broadcast...</span>
          )}
        </div>
      </div>

      {showModal && (
        <AgentEditorModal
          agentName={name}
          response={response}
          color={color}
          onClose={() => setShowModal(false)}
        />
      )}
    </>
  );
}

export default AgentResponse;
