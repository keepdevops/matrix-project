import React, { useEffect, useState } from 'react';
import './App.css';
import { useSwarm } from './hooks/useSwarm';
import { clearCache, fetchAgents } from './api/swarmApi';
import PromptInput from './components/PromptInput';
import AgentResponse from './components/AgentResponse';
import CodeDisplay from './components/CodeDisplay';
import SwarmConfig from './components/SwarmConfig';
import { extractCodeBlock } from './utils/codeExtractor';

const AGENT_COLORS = {
  architect:  '#FFB000',
  specialist: '#648FFF',
  scout:      '#DC267F',
  programmer: '#00ff41',
  synthesis:  '#FE6100',
  reviewer:   '#785EF0',
  tester:     '#00B4D8',
  security:   '#FF4C4C',
  devops:     '#06D6A0',
  documenter: '#FFD166',
  optimizer:  '#EF476F',
  debugger:   '#118AB2',
  database:   '#A8DADC',
  frontend:   '#F77F00',
  api:        '#4CC9F0',
};
const getAgentColor = name => AGENT_COLORS[name] || '#888888';

const METADATA_KEYS = new Set(['prompt', 'temperature', 'timestamp']);

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

  const [activeAgents, setActiveAgents] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [deployPending, setDeployPending] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [selectedPrompt, setSelectedPrompt] = useState(null);
  const [selectedTemperature, setSelectedTemperature] = useState(null);
  const [cacheStatus, setCacheStatus] = useState('idle');

  const refreshAgents = () =>
    fetchAgents().then(setActiveAgents).catch(() => {});

  useEffect(() => {
    checkStatus();
    loadHistory();
    refreshAgents();
    const interval = setInterval(() => {
      checkStatus();
      if (online) refreshAgents();
    }, 10000);
    return () => clearInterval(interval);
  }, [checkStatus, loadHistory]); // eslint-disable-line

  // Auto-show config panel when offline with no agents (suppress while deploy is pending)
  const showConfigPanel = showConfig || (!online && !deployPending && activeAgents.length === 0);

  const handleDeployed = () => {
    setShowConfig(false);
    setDeployPending(true);
    // Poll until coordinator is online, then clear the pending flag
    const pollId = setInterval(async () => {
      const isOnline = await checkStatus();
      if (isOnline) {
        clearInterval(pollId);
        setDeployPending(false);
        refreshAgents();
        loadHistory();
      }
    }, 2000);
    // Safety: stop polling after 90s regardless
    setTimeout(() => { clearInterval(pollId); setDeployPending(false); }, 90000);
  };

  const handleHistorySelect = entry => {
    const resps = {};
    Object.keys(entry).forEach(k => {
      if (!METADATA_KEYS.has(k)) resps[k] = entry[k] || null;
    });
    setResponses(resps);
    setSelectedPrompt(entry.prompt || '');
    setSelectedTemperature(entry.temperature ?? 0.7);
    setShowHistory(false);
  };

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
      loadHistory();
    } catch (err) {
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
            className={`configure-button ${showConfigPanel ? 'active' : ''}`}
            onClick={() => setShowConfig(v => !v)}
          >
            CONFIGURE
          </button>
          <button
            className="history-button"
            onClick={() => setShowHistory(!showHistory)}
          >
            HISTORY ({history.length})
          </button>
          <button
            className="help-button"
            onClick={() => setShowHelp(true)}
          >
            ?
          </button>
        </div>
      </header>

      {showConfigPanel && (
        <SwarmConfig onDeployed={handleDeployed} />
      )}

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

      {!showConfigPanel && (
        <>
          <PromptInput
            onSubmit={handleSubmit}
            loading={loading}
            disabled={!online}
            externalPrompt={selectedPrompt}
            externalTemperature={selectedTemperature}
          />

          {error && (
            <div className="error-banner">ERROR: {error}</div>
          )}

          <div className="agents-grid">
            {activeAgents.map(({ name, port }) => (
              <AgentResponse
                key={name}
                name={name.toUpperCase()}
                port={String(port)}
                response={responses[name] || null}
                color={getAgentColor(name)}
                loading={loading}
              />
            ))}
          </div>

          {responses.programmer && (() => {
            const { code, language } = extractCodeBlock(responses.programmer);
            return (
              <div className="code-output-section">
                <h2 className="section-title">CODE OUTPUT</h2>
                <div className="editor-frame">
                  <CodeDisplay initialCode={code} language={language} />
                </div>
              </div>
            );
          })()}
        </>
      )}

      {showHelp && (
        <div className="help-overlay" onClick={() => setShowHelp(false)}>
          <div className="help-modal" onClick={e => e.stopPropagation()}>
            <div className="help-header">
              <span>MATRIX SWARM — HELP</span>
              <button className="help-close" onClick={() => setShowHelp(false)}>✕</button>
            </div>
            <div className="help-body">

              <div className="help-section">
                <h3>Header Controls</h3>
                <dl>
                  <dt>ONLINE / OFFLINE</dt>
                  <dd>Coordinator status. Red means the backend is unreachable — open CONFIGURE to deploy a swarm.</dd>
                  <dt>CONFIGURE</dt>
                  <dd>Opens the swarm configuration panel. Select which agents to activate, assign models, and click LAUNCH SWARM. Same-model agents automatically share one server instance.</dd>
                  <dt>CLEAR KV</dt>
                  <dd>Erases the KV cache on all agent servers. Use this when agents seem stuck or after switching to a very different task.</dd>
                  <dt>HISTORY</dt>
                  <dd>Shows your last 10 prompts. Click any entry to reload it.</dd>
                </dl>
              </div>

              <div className="help-section">
                <h3>Submitting a Prompt</h3>
                <dl>
                  <dt>Prompt box</dt>
                  <dd>All active agents receive the same prompt simultaneously.</dd>
                  <dt>Temperature</dt>
                  <dd><code>0.1</code> = focused/deterministic. <code>1.0</code> = creative/varied.</dd>
                  <dt>BROADCAST / Cmd+Enter</dt>
                  <dd>Dispatches to all agents in parallel.</dd>
                </dl>
              </div>

              <div className="help-section">
                <h3>Agent Roles</h3>
                <div className="help-roles">
                  {[
                    ['architect','System design, ASCII UML, component diagrams'],
                    ['specialist','C++/Go, performance, memory management'],
                    ['scout','Codebase analysis, patterns, dependencies'],
                    ['programmer','Complete production-ready code (large context)'],
                    ['synthesis','Execution roadmap, risk analysis, planning'],
                    ['reviewer','Bugs, code smells, anti-patterns'],
                    ['tester','Unit tests, integration tests, edge cases'],
                    ['security','OWASP risks, vulnerabilities, remediation'],
                    ['devops','CI/CD, containers, infrastructure-as-code'],
                    ['documenter','API docs, READMEs, inline comments'],
                    ['optimizer','Bottlenecks, algorithmic improvements'],
                    ['debugger','Root cause analysis, error propagation'],
                    ['database','Schemas, queries, indexing, caching'],
                    ['frontend','React, CSS, accessibility, UX'],
                    ['api','REST/GraphQL design, OpenAPI, versioning'],
                  ].map(([name, desc]) => (
                    <div key={name} className="help-role-row">
                      <span className="help-role-name" style={{color: getAgentColor(name)}}>{name}</span>
                      <span className="help-role-desc">{desc}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="help-section">
                <h3>Launch</h3>
                <code className="help-code">bash scripts/launch_matrix.sh</code>
                <p>Starts the proxy and UI. Configure your swarm from the browser — no terminal required.</p>
              </div>

            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
