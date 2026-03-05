import React from 'react';

/**
 * Component to display individual agent response
 */
function AgentResponse({ name, response, color = '#00ff41', loading = false, port }) {
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
    <div className="agent-response" style={{ '--agent-color': color }}>
      <div className="agent-header">
        <span className="agent-name">{name}</span>
        {port && <span className="agent-port">({port})</span>}
        <span className={`agent-status ${getStatusClass()}`}>
          {getStatusText()}
        </span>
      </div>
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
  );
}

export default AgentResponse;
