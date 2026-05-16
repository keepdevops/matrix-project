import React, { useEffect, useState } from 'react';
import './App.css';
import './themes/light.css';
import { useSwarm } from './hooks/useSwarm';
import {
  clearCache,
  fetchAgents,
  fetchKvPressure,
  fetchSwarmConfig,
  fetchModels,
  fetchModes,
  setActiveMode,
} from './api/swarmApi';
import PromptInput from './components/PromptInput';
import AgentGrid from './components/AgentGrid';
import MetricsStrip from './components/MetricsStrip';
import SwarmConfig from './components/SwarmConfig';
import HelpModal from './components/HelpModal';
import ModeSelector from './components/ModeSelector';
import FinalAnswerPanel from './components/FinalAnswerPanel';
import RagSources from './components/RagSources';
import RagAdmin from './components/RagAdmin';
import CachePanel from './components/CachePanel';
import KvPressureGauge from './components/KvPressureGauge';
import PressureCluster from './components/PressureCluster';
import { extractCodeBlock } from './utils/codeExtractor';
import { qualityPassContextPolicy } from './utils/qualityPassContext';

const METADATA_KEYS = new Set(['prompt', 'temperature', 'timestamp', '_final', '_mode', '_session_id', '_run_id']);

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
    currentSession,
    setCurrentSession,
  } = useSwarm();

  const [activeAgents, setActiveAgents] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showConfig, setShowConfig] = useState(true);
  const [deployPending, setDeployPending] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showRagAdmin, setShowRagAdmin] = useState(false);
  const [showCachePanel, setShowCachePanel] = useState(false);
  const [selectedPrompt, setSelectedPrompt] = useState(null);
  const [selectedTemperature, setSelectedTemperature] = useState(null);
  const [cacheStatus, setCacheStatus] = useState('idle');
  const [useRag, setUseRag] = useState(false);

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

  const [kvReadings, setKvReadings] = useState([]);
  const [kvFetchFailed, setKvFetchFailed] = useState(false);

  const [flatPickAgent, setFlatPickAgent] = useState(null);

  useEffect(() => {
    if (activeMode !== 'flat') setFlatPickAgent(null);
  }, [activeMode]);

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
    const pollMs = 250;
    if (!online) {
      setKvReadings([]);
      setKvFetchFailed(false);
      return undefined;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const data = await fetchKvPressure();
        if (cancelled) return;
        setKvReadings(Array.isArray(data) ? data : []);
        setKvFetchFailed(false);
      } catch (err) {
        console.error('KV pressure poll failed:', err);
        if (!cancelled) setKvFetchFailed(true);
      }
    };
    tick();
    const id = setInterval(tick, pollMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [online]);

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
    if (entry._session_id && entry._run_id) {
      setCurrentSession({ sessionId: entry._session_id, runId: entry._run_id });
    }
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

  const handleSubmit = async (prompt, temperature, opts = {}) => {
    try {
      await submit(prompt, temperature, { useRag, ...opts });
      loadHistory();
    } catch (err) {
      console.error('Submission failed:', err);
    }
  };

  const handleQualityPass = async (temperature = 0.2) => {
    const instruction = [
      'Review the previous output for compile errors, duplicate files/functions,',
      'missing implementation, unsafe numeric types, and mismatch with the original prompt.',
      'Produce a corrected final answer.',
    ].join(' ');
    await handleSubmit(instruction, temperature, {
      followup: true,
      qualityPass: true,
      contextPolicy: qualityPassContextPolicy(activeMode || 'pipeline'),
    });
  };

  const excludedBreaker = lastMeta?.excluded_unhealthy || [];
  const stageOutputs = Array.isArray(lastMeta?.stage_outputs) ? lastMeta.stage_outputs : [];

  const handleSendBestContinue = async (temperature = 0.2) => {
    if (!flatPickAgent || !responses[flatPickAgent]) return;
    await handleSubmit(
      'Refine and finalize the selected variant. Address gaps, risks, and production readiness.',
      temperature,
      {
        followup: true,
        contextPolicy: {
          include: ['original_prompt', 'final', flatPickAgent],
          target_agent: flatPickAgent,
          max_context_chars: 30000,
        },
      },
    );
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
          <KvPressureGauge online={online} readings={kvReadings} fetchFailed={kvFetchFailed} />
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
            onClick={() => setShowRagAdmin(true)}
            title="Upload/manage RAG documents"
          >
            RAG DOCS
          </button>
          <button
            className="help-button"
            onClick={() => setShowCachePanel(true)}
            title="Inspect and manage the response cache"
          >
            CACHE
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
          <PressureCluster online={online} readings={kvReadings} fetchFailed={kvFetchFailed} />
          <PromptInput
            onSubmit={handleSubmit}
            loading={loading}
            disabled={!online}
            externalPrompt={selectedPrompt}
            externalTemperature={selectedTemperature}
            onPromptConsumed={() => setSelectedPrompt(null)}
            canContinue={Boolean(currentSession?.sessionId)}
            onQualityPass={handleQualityPass}
            useRag={useRag}
            onUseRagChange={setUseRag}
          />
          {excludedBreaker.length > 0 && (
            <div className="dispatch-hint-banner dispatch-hint-banner--breaker" role="status">
              Skipped (circuit breaker open):{' '}
              <strong>{excludedBreaker.join(', ')}</strong>. Cooldown ~30s after failures — see PER-MODE ROSTER health or coordinator logs.
            </div>
          )}
          {error && (
            <div className="error-banner">
              {error.includes('Coordinator offline')
                ? 'Swarm not running — open CONFIGURE and click LAUNCH SWARM.'
                : `ERROR: ${error}`}
            </div>
          )}
          <FinalAnswerPanel text={finalAnswer} />
          <RagSources rag={lastMeta?.rag} />
          <MetricsStrip envelope={{ meta: lastMeta }} />
          {stageOutputs.length > 0 && (
            <div className="final-answer-panel" style={{ marginTop: '0.75rem' }}>
              <div className="swarm-config-title">PIPELINE STAGE OUTPUTS</div>
              {stageOutputs.map(stage => (
                <details key={`${stage.step}-${stage.agent}`} style={{ marginTop: '0.4rem' }}>
                  <summary>
                    {stage.step}. {stage.agent}
                  </summary>
                  <pre style={{ whiteSpace: 'pre-wrap', marginTop: '0.4rem' }}>
                    {stage.output}
                  </pre>
                </details>
              ))}
            </div>
          )}
          <AgentGrid
            activeAgents={activeAgents}
            responses={responses}
            loading={loading}
            onSaveCode={handleSaveCode}
            flatPickMode={activeMode === 'flat'}
            pickedFlatAgent={flatPickAgent}
            onPickFlatAgent={setFlatPickAgent}
            onExpandProgrammer={(instruction) => handleSubmit(instruction, 0.2, {
              followup: true,
              contextPolicy: {
                include: ['original_prompt', 'final', 'programmer'],
                target_agent: 'programmer',
                max_context_chars: 24000,
              },
            })}
          />
          {activeMode === 'flat' && Object.keys(responses).length > 0 && (
            <div className="final-answer-panel" style={{ marginTop: '0.75rem' }}>
              <div className="swarm-config-title">COMPARE VARIANTS</div>
              <div
                style={{
                  display: 'flex',
                  gap: '0.5rem',
                  overflowX: 'auto',
                  paddingBottom: '0.35rem',
                  marginTop: '0.35rem',
                }}
              >
                {activeAgents.map(({ name }) => {
                  const text = responses[name];
                  if (!text) return null;
                  const isPicked = flatPickAgent === name;
                  return (
                    <div
                      key={name}
                      role="button"
                      tabIndex={0}
                      onClick={() => setFlatPickAgent(isPicked ? null : name)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setFlatPickAgent(isPicked ? null : name); }}
                      style={{
                        flex: '0 0 min(280px, 45vw)',
                        maxHeight: '180px',
                        overflow: 'auto',
                        fontSize: '0.78rem',
                        border: isPicked
                          ? '2px solid #00ff41'
                          : '1px solid color-mix(in srgb, var(--fg, #ccc) 25%, transparent)',
                        borderRadius: 4,
                        padding: '0.35rem',
                        cursor: 'pointer',
                        boxShadow: isPicked ? '0 0 0 1px #00ff4166' : 'none',
                        background: isPicked ? 'rgba(0,255,65,0.06)' : 'transparent',
                        userSelect: 'none',
                      }}
                    >
                      <div style={{ fontWeight: 700, marginBottom: '0.25rem', display: 'flex', justifyContent: 'space-between' }}>
                        <span>{name}</span>
                        {isPicked && <span style={{ color: '#00ff41', fontSize: '0.7rem' }}>✓ SELECTED</span>}
                      </div>
                      <pre style={{ whiteSpace: 'pre-wrap', margin: 0, userSelect: 'text' }}>{text}</pre>
                    </div>
                  );
                })}
              </div>
              <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontSize: '0.8rem', opacity: 0.85 }}>
                  Pick best variant in the grid (highlight), then continue refinement:
                </span>
                <button
                  type="button"
                  className="submit-button continue-button"
                  disabled={loading || !flatPickAgent}
                  onClick={() => handleSendBestContinue(0.2)}
                >
                  SEND BEST TO CONTINUE
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
      {showRagAdmin && <RagAdmin onClose={() => setShowRagAdmin(false)} />}
      {showCachePanel && <CachePanel onClose={() => setShowCachePanel(false)} />}
    </div>
  );
}

export default App;
