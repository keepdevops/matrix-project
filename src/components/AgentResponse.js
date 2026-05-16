import React, { useState } from 'react';
import AgentEditorModal from './AgentEditorModal';

function AgentResponse({ name, response, color = '#00ff41', loading = false, port, model, engine,
                         tokenStats = null, picked = false, pickable = false, onPick = null }) {
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
      <div
        className={`agent-response${picked ? ' agent-response--picked' : ''}${pickable ? ' agent-response--pickable' : ''}`}
        style={{ '--agent-color': color }}
        onClick={onPick || undefined}
      >
        <div className="agent-header">
          <span className="agent-name">{name}</span>
          {port && <span className="agent-port">({port})</span>}
          <span className={`agent-status ${getStatusClass()}`}>
            {getStatusText()}
          </span>
          {response && (
            <button
              className="agent-expand-btn"
              onClick={(e) => {
                e.stopPropagation();
                setShowModal(true);
              }}
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
        {tokenStats && (
          <div className="agent-token-stats">
            <span className="agent-token-item" title="Prompt tokens">
              ↑{tokenStats.prompt_tokens ?? '—'}
            </span>
            <span className="agent-token-item" title="Completion tokens">
              ↓{tokenStats.completion_tokens ?? '—'}
            </span>
            <span className="agent-token-item" title="Latency">
              {tokenStats.total_ms != null ? `${(tokenStats.total_ms / 1000).toFixed(1)}s` : '—'}
            </span>
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
