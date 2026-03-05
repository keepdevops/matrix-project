import React, { useEffect, useState } from 'react';
import './App.css';
import { useSwarm } from './hooks/useSwarm';
import PromptInput from './components/PromptInput';
import AgentResponse from './components/AgentResponse';
import CodeDisplay from './components/CodeDisplay';
import { extractCodeBlock } from './utils/codeExtractor';

// Agent color scheme (colorblind-friendly)
const AGENT_COLORS = {
  logic: '#648FFF',     // Blue
  utility: '#DC267F',   // Magenta
  architect: '#FFB000', // Gold
};

function App() {
  const {
    responses,
    loading,
    error,
    history,
    online,
    submit,
    loadHistory,
    checkStatus,
    setResponses,
  } = useSwarm();

  const [showHistory, setShowHistory] = useState(false);
  const [selectedPrompt, setSelectedPrompt] = useState(null);
  const [selectedTemperature, setSelectedTemperature] = useState(null);
  const [editedCode, setEditedCode] = useState(null);

  const handleHistorySelect = (entry) => {
    // Reload responses into the agent panels and code display
    setResponses({
      logic: entry.logic || null,
      utility: entry.utility || null,
      architect: entry.architect || null,
    });
    // Reload prompt and temperature into the input
    setSelectedPrompt(entry.prompt || '');
    setSelectedTemperature(entry.temperature ?? 0.7);
    setEditedCode(null);
    setShowHistory(false);
  };

  useEffect(() => {
    // Check coordinator status on mount
    checkStatus();
    loadHistory();

    // Poll status every 10 seconds
    const interval = setInterval(checkStatus, 10000);
    return () => clearInterval(interval);
  }, [checkStatus, loadHistory]);

  const handleSubmit = async (prompt, temperature) => {
    try {
      await submit(prompt, temperature);
      // Refresh history after successful submission
      loadHistory();
    } catch (err) {
      // Error is already handled in the hook
      console.error('Submission failed:', err);
    }
  };

  return (
    <div className="matrix-container">
      <header>
        <h1>MATRIX SWARM v1.0</h1>
        <div className="header-controls">
          <span className={`status-indicator ${online ? 'status-online' : 'status-offline'}`}>
            {online ? 'ONLINE' : 'OFFLINE'}
          </span>
          <button
            className="history-button"
            onClick={() => setShowHistory(!showHistory)}
          >
            HISTORY ({history.length})
          </button>
        </div>
      </header>

      {showHistory && history.length > 0 && (
        <div className="history-dropdown">
          {history.slice(-10).reverse().map((entry, index) => (
            <div key={index} className="history-item" onClick={() => handleHistorySelect(entry)}>
              <span className="history-prompt">
                {entry.prompt?.substring(0, 50)}
                {entry.prompt?.length > 50 ? '...' : ''}
              </span>
              <span className="history-time">
                {entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : ''}
              </span>
            </div>
          ))}
        </div>
      )}

      <PromptInput
        onSubmit={handleSubmit}
        loading={loading}
        disabled={!online}
        externalPrompt={selectedPrompt}
        externalTemperature={selectedTemperature}
      />

      {error && (
        <div className="error-banner">
          ERROR: {error}
        </div>
      )}

      <div className="agents-grid">
        <AgentResponse
          name="Logic"
          port="8081"
          response={responses.logic}
          color={AGENT_COLORS.logic}
          loading={loading}
        />
        <AgentResponse
          name="Utility"
          port="8082"
          response={responses.utility}
          color={AGENT_COLORS.utility}
          loading={loading}
        />
        <AgentResponse
          name="Architect"
          port="8080"
          response={responses.architect}
          color={AGENT_COLORS.architect}
          loading={loading}
        />
      </div>

      {responses.architect && (
        <div className="code-output-section">
          <h2 className="section-title">CODE OUTPUT</h2>
          <div className="editor-frame">
            <CodeDisplay
              initialCode={extractCodeBlock(responses.architect).code}
              language={extractCodeBlock(responses.architect).language}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
