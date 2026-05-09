import React, { useEffect, useState } from 'react';
import './App.css';
import './themes/light.css';
import { useSwarm } from './hooks/useSwarm';
import { clearCache, fetchAgents, fetchSwarmConfig, fetchModels, fetchModes, setActiveMode } from './api/swarmApi';
import PromptInput from './components/PromptInput';
import AgentGrid from './components/AgentGrid';
import MetricsStrip from './components/MetricsStrip';
import SwarmConfig from './components/SwarmConfig';
import HelpModal from './components/HelpModal';
import ModeSelector from './components/ModeSelector';
import FinalAnswerPanel from './components/FinalAnswerPanel';
import KvPressureGauge from './components/KvPressureGauge';
import PressureCluster from './components/PressureCluster';
import { extractCodeBlock } from './utils/codeExtractor';

const METADATA_KEYS = new Set(['prompt', 'temperature', 'timestamp', '_final', '_mode']);

const ENGINE_LABELS = { llama: 'LLAMA', mlx: 'MLX', vllm: 'vLLM', docker: 'DOCKER' };
function getEngineLabel(backend) {
  return ENGINE_LABELS[backend] || backend || null;
}
function getRunningEngines(agents) {
  const backends = new Set();
  agents.forEach(a => { if (a.backend) backends.add(a.backend); });
  return [...backends].map(getEngineLabel).filter(Boolean);
}

function App() {
  const {
    responses,
    finalAnswer,
    loading,
    error,
    history,
    online,
    submit,
    loadHistory,
    checkStatus,
    setResponses,
    setFinalAnswer,
    lastMeta,
    setLastMeta,
  } = useSwarm();

  const [activeAgents, setActiveAgents] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showConfig, setShowConfig] = useState(true);
  const [deployPending, setDeployPending] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [selectedPrompt, setSelectedPrompt] = useState(null);
  const [selectedTemperature, setSelectedTemperature] = useState(null);
  const [cacheStatus, setCacheStatus] = useState('idle');

  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem('swarm-matrix-theme');
      if (saved === 'light' || saved === 'dark') return saved;
    } catch (err) {
      console.error('Failed to read theme from localStorage:', err);
    }
    return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  });

  useEffect(() => {
    document.body.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('swarm-matrix-theme', theme);
    } catch (err) {
      console.error('Failed to persist theme:', err);
    }
  }, [theme]);

  const [agentMeta, setAgentMeta] = useState({}); // { [name]: { model, backend } }

  const [modes, setModes] = useState([]);
  const [activeMode, setActiveModeState] = useState(null);

  const refreshModes = () =>
    fetchModes()
      .then(list => {
        setModes(list);
        const cur = list.find(m => m.active);
        if (cur) setActiveModeState(cur.name);
      })
      .catch(() => {});

  const handleModeChange = async (name) => {
    try {
      await setActiveMode(name);
      setActiveModeState(name);
      setModes(prev => prev.map(m => ({ ...m, active: m.name === name })));
    } catch (err) {
      console.error('Failed to change mode:', err);
    }
  };

  const refreshAgents = () =>
    fetchAgents()
      .then(agents => {
        setActiveAgents(agents.map(a => ({
          ...a,
          model: a.model || agentMeta[a.name]?.model || null,
          backend: a.backend || agentMeta[a.name]?.backend || null,
        })));
      })
      .catch(() => {});

  useEffect(() => {
    Promise.all([fetchSwarmConfig().catch(() => null), fetchModels().catch(() => [])])
      .then(([cfg, models]) => {
        if (!cfg?.agents) return;
        const pathToBackend = Object.fromEntries((models || []).map(m => [m.path, m.backend]));
        const meta = {};
        cfg.agents.forEach(a => {
          meta[a.name] = {
            model: a.model || null,
            backend: a.backend || a.engine || pathToBackend[a.model] || null,
          };
        });
        setAgentMeta(meta);
      })
      .catch(err => console.error('Failed to load agent metadata:', err));
  }, []);

  useEffect(() => {
    checkStatus();
    loadHistory();
    refreshAgents();
    refreshModes();
    const interval = setInterval(() => {
      checkStatus();
      if (online) { refreshAgents(); refreshModes(); }
    }, 10000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkStatus, loadHistory]); // eslint-disable-line

  // When the coordinator comes online (after LAUNCH SWARM), refresh modes and
  // agents. Without this the ModeSelector stays stuck on "UNKNOWN" because
  // the initial mount-time fetch happened before the coordinator existed.
  useEffect(() => {
    if (online) {
      refreshModes();
      refreshAgents();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  const showConfigPanel = showConfig || (!online && !deployPending && activeAgents.length === 0);

  const handleDeployed = () => {
    setShowConfig(false);
    setDeployPending(true);
    const pollId = setInterval(async () => {
      const isOnline = await checkStatus();
      if (isOnline) {
        clearInterval(pollId);
        setDeployPending(false);
        refreshAgents();
        loadHistory();
      }
    }, 2000);
    setTimeout(() => { clearInterval(pollId); setDeployPending(false); }, 90000);
  };

  const handleHistorySelect = entry => {
    const resps = {};
    Object.keys(entry).forEach(k => {
      if (!METADATA_KEYS.has(k)) resps[k] = entry[k] || null;
    });
    setResponses(resps);
    setFinalAnswer(entry._final || null);
    setLastMeta(null);  // history entries don't carry per-run timings (yet)
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

  const handleSaveCode = () => {
    const sections = [];
    activeAgents.forEach(({ name }) => {
      const resp = responses[name];
      if (!resp) return;
      const { code, language } = extractCodeBlock(resp);
      if (!code || code.trim().length < 10) return;
      sections.push(`// === ${name.toUpperCase()} (${language}) ===\n\n${code}`);
    });
    if (!sections.length) return;
    const separator = '\n\n// ────────────────────────────────────────────\n\n';
    const blob = new Blob([sections.join(separator)], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `swarm-matrix-${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
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
        <h1>Swarm Matrix v{process.env.REACT_APP_VERSION || 'dev'}</h1>
        <div className="header-controls">
          <span className={`status-indicator ${online ? 'status-online' : 'status-offline'}`}>
            {online ? 'ONLINE' : 'OFFLINE'}
          </span>
          {online && getRunningEngines(activeAgents).length > 0 && (
            <span className="engine-badge" title="Inference engine(s) in use">
              {getRunningEngines(activeAgents).join(' + ')}
            </span>
          )}
          <ModeSelector
            modes={modes}
            active={activeMode}
            onChange={handleModeChange}
            disabled={!online}
          />
          <KvPressureGauge online={online} />
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
          <button className="help-button" onClick={() => setShowHelp(true)}>
            ?
          </button>
          <button
            className="theme-toggle-button"
            onClick={() => setTheme(t => (t === 'dark' ? 'light' : 'dark'))}
            aria-label="Toggle theme"
            title="Toggle light/dark mode"
          >
            {theme === 'dark' ? '☀ Light' : '☾ Dark'}
          </button>
        </div>
      </header>

      {showConfigPanel && <SwarmConfig onDeployed={handleDeployed} />}

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
          <PressureCluster online={online} />
          <PromptInput
            onSubmit={handleSubmit}
            loading={loading}
            disabled={!online}
            externalPrompt={selectedPrompt}
            externalTemperature={selectedTemperature}
            onPromptConsumed={() => setSelectedPrompt(null)}
          />
          {error && (
            <div className="error-banner">
              {error.includes('Coordinator offline')
                ? 'Swarm not running — open CONFIGURE and click LAUNCH SWARM.'
                : `ERROR: ${error}`}
            </div>
          )}
          <FinalAnswerPanel text={finalAnswer} />
          <MetricsStrip envelope={{ meta: lastMeta }} />
          <AgentGrid
            activeAgents={activeAgents}
            responses={responses}
            loading={loading}
            onSaveCode={handleSaveCode}
          />
        </>
      )}

      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
    </div>
  );
}

export default App;
