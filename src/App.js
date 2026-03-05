import React, { useEffect, useState } from 'react';
import './App.css';
import { useSwarm } from './hooks/useSwarm';
import { clearCache } from './api/swarmApi';
import PromptInput from './components/PromptInput';
import AgentResponse from './components/AgentResponse';
import CodeDisplay from './components/CodeDisplay';
import { extractCodeBlock } from './utils/codeExtractor';

// Agent color scheme (IBM colorblind-friendly palette)
const AGENT_COLORS = {
  architect:  '#FFB000', // Gold
  specialist: '#648FFF', // Blue
  scout:      '#DC267F', // Magenta
  programmer: '#00ff41', // Matrix Green
  synthesis:  '#FE6100', // Orange
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
  const [cacheStatus, setCacheStatus] = useState('idle'); // idle | clearing | cleared | failed

  const handleHistorySelect = (entry) => {
    // Reload responses into the agent panels and code display
    setResponses({
      architect:  entry.architect  || null,
      specialist: entry.specialist || null,
      scout:      entry.scout      || null,
      programmer: entry.programmer || null,
      synthesis:  entry.synthesis  || null,
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

  const handleClearCache = async () => {
    setCacheStatus('clearing');
    try {
      await clearCache();
      setCacheStatus('cleared');
    } catch {
      setCacheStatus('failed');
    } finally {
      setTimeout(() => setCacheStatus('idle'), 2000);
    }
  };

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
            className={`cache-button cache-button--${cacheStatus}`}
            onClick={handleClearCache}
            disabled={cacheStatus === 'clearing' || !online}
          >
            {cacheStatus === 'clearing' ? 'CLEARING...'
              : cacheStatus === 'cleared' ? 'CLEARED'
              : cacheStatus === 'failed'  ? 'FAILED'
              : 'CLEAR KV'}
          </button>
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
          name="LEAD ARCHITECT"
          port="8080"
          response={responses.architect}
          color={AGENT_COLORS.architect}
          loading={loading}
        />
        <AgentResponse
          name="SYSTEMS SPECIALIST"
          port="8081"
          response={responses.specialist}
          color={AGENT_COLORS.specialist}
          loading={loading}
        />
        <AgentResponse
          name="CONTEXT SCOUT"
          port="8082"
          response={responses.scout}
          color={AGENT_COLORS.scout}
          loading={loading}
        />
        <AgentResponse
          name="PROGRAMMER"
          port="8083"
          response={responses.programmer}
          color={AGENT_COLORS.programmer}
          loading={loading}
        />
        <AgentResponse
          name="SYNTHESIS"
          port="8084"
          response={responses.synthesis}
          color={AGENT_COLORS.synthesis}
          loading={loading}
        />
      </div>

      {responses.programmer && (
        <div className="code-output-section">
          <h2 className="section-title">CODE OUTPUT</h2>
          <div className="editor-frame">
            <CodeDisplay
              initialCode={extractCodeBlock(responses.programmer).code}
              language={extractCodeBlock(responses.programmer).language}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
