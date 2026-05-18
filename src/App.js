import React, { useCallback, useEffect, useState } from 'react';
import './App.css';
import './themes/light.css';
import { useSwarm } from './hooks/useSwarm';
import { useCoordinatorState } from './hooks/useCoordinatorState';
import { clearKvCache } from './api/swarmApi';
import AppHeader from './components/AppHeader';
import PromptInput from './components/PromptInput';
import AgentGrid from './components/AgentGrid';
import MetricsStrip from './components/MetricsStrip';
import SwarmConfig from './components/SwarmConfig';
import ModelConverter from './components/ModelConverter';
import HelpModal from './components/HelpModal';
import FinalAnswerPanel from './components/FinalAnswerPanel';
import RagSources from './components/RagSources';
import RagAdmin from './components/RagAdmin';
import CachePanel from './components/CachePanel';
import PressureCluster from './components/PressureCluster';
import PipelineStageOutputs from './components/PipelineStageOutputs';
import CompareVariantsPanel from './components/CompareVariantsPanel';
import ConversationThread from './components/ConversationThread';
import { extractCodeBlock } from './utils/codeExtractor';
import { qualityPassContextPolicy } from './utils/qualityPassContext';

const METADATA_KEYS = new Set(['prompt', 'temperature', 'timestamp', '_final', '_mode', '_session_id', '_run_id']);

function App() {
  const {
    responses, finalAnswer, loading, error, history, online,
    submit, loadHistory, checkStatus,
    setResponses, setFinalAnswer, lastMeta, setLastMeta,
    currentSession, setCurrentSession,
  } = useSwarm();

  const {
    activeAgents, modes, activeMode, kvReadings, kvFetchFailed,
    flatPickAgent, setFlatPickAgent, refreshModes, refreshAgents, handleModeChange,
  } = useCoordinatorState(online);

  const [showHistory, setShowHistory]     = useState(false);
  const [showConfig, setShowConfig]       = useState(true);
  const [deployPending, setDeployPending] = useState(false);
  const [showHelp, setShowHelp]           = useState(false);
  const [showConverter, setShowConverter]   = useState(false);
  const [showRagAdmin, setShowRagAdmin]   = useState(false);
  const [showCachePanel, setShowCachePanel] = useState(false);
  const [selectedPrompt, setSelectedPrompt]           = useState(null);
  const [selectedTemperature, setSelectedTemperature] = useState(null);
  const [cacheStatus, setCacheStatus] = useState('idle');
  const [useRag, setUseRag]           = useState(false);

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
  }, [checkStatus, loadHistory]);

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
    setLastMeta(null);
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
      await clearKvCache();
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

  const handleSubmit = useCallback(async (prompt, temperature, opts = {}) => {
    try {
      const autoOpts = { ...opts };
      if (currentSession?.sessionId && !opts.followup && !opts.qualityPass) {
        const hasFinal = ['pipeline', 'cascade'].includes(activeMode);
        autoOpts.followup = true;
        autoOpts.contextPolicy = autoOpts.contextPolicy || {
          include: hasFinal ? ['original_prompt', 'final'] : ['original_prompt'],
          max_context_chars: 20000,
        };
      }
      await submit(prompt, temperature, { useRag, ...autoOpts });
      loadHistory();
    } catch (err) {
      console.error('Submission failed:', err);
    }
  }, [submit, loadHistory, currentSession, activeMode, useRag]);

  const handleQualityPass = useCallback(async (temperature = 0.2) => {
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
  }, [handleSubmit, activeMode]);

  const handlePromptConsumed = useCallback(() => setSelectedPrompt(null), []);

  const handleFollowUp = async (text, contextPolicy) => {
    await handleSubmit(text, 0.5, { followup: true, contextPolicy });
    loadHistory();
  };

  const handleClearSession = () => {
    setCurrentSession(null);
    setResponses({});
    setFinalAnswer(null);
    setLastMeta(null);
  };

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

  const excludedBreaker = lastMeta?.excluded_unhealthy || [];
  const stageOutputs = Array.isArray(lastMeta?.stage_outputs) ? lastMeta.stage_outputs : [];

  return (
    <div className="matrix-container">
      <AppHeader
        online={online}
        activeAgents={activeAgents}
        modes={modes}
        activeMode={activeMode}
        kvReadings={kvReadings}
        kvFetchFailed={kvFetchFailed}
        cacheStatus={cacheStatus}
        showConfigPanel={showConfigPanel}
        theme={theme}
        historyCount={history.length}
        onModeChange={handleModeChange}
        onClearCache={handleClearCache}
        onToggleConfig={() => setShowConfig(v => !v)}
        onToggleHistory={() => setShowHistory(v => !v)}
        onOpenConverter={() => setShowConverter(v => !v)}
        onOpenRagAdmin={() => setShowRagAdmin(true)}
        onOpenCachePanel={() => setShowCachePanel(true)}
        onOpenHelp={() => setShowHelp(true)}
        onToggleTheme={() => setTheme(t => (t === 'dark' ? 'light' : 'dark'))}
      />

      {showConverter && (
        <div style={{ padding: '1rem 1.5rem', maxWidth: 860, margin: '0 auto' }}>
          <ModelConverter standalone />
        </div>
      )}

      {!showConverter && showConfigPanel && <SwarmConfig onDeployed={handleDeployed} />}

      {showHistory && history.length > 0 && (
        <div className="history-dropdown">
          {history.slice(-10).reverse().map((entry, index) => (
            <div key={index} className="history-item" onClick={() => handleHistorySelect(entry)}>
              <span className="history-prompt">
                {entry.prompt?.substring(0, 50)}{entry.prompt?.length > 50 ? '...' : ''}
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
            onPromptConsumed={handlePromptConsumed}
            canContinue={Boolean(currentSession?.sessionId)}
            onQualityPass={handleQualityPass}
            useRag={useRag}
            onUseRagChange={setUseRag}
            activeAgents={activeAgents}
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
          <ConversationThread
            history={history}
            sessionId={currentSession?.sessionId}
            responses={responses}
            finalAnswer={finalAnswer}
            loading={loading}
            onFollowUp={handleFollowUp}
            onClear={handleClearSession}
          />
          <FinalAnswerPanel text={finalAnswer} />
          <RagSources rag={lastMeta?.rag} />
          <MetricsStrip envelope={{ meta: lastMeta }} />
          <PipelineStageOutputs stageOutputs={stageOutputs} />
          <AgentGrid
            activeAgents={activeAgents}
            responses={responses}
            loading={loading}
            timings={lastMeta?.timings || {}}
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
            <CompareVariantsPanel
              activeAgents={activeAgents}
              responses={responses}
              loading={loading}
              flatPickAgent={flatPickAgent}
              onPickAgent={setFlatPickAgent}
              onSendBest={() => handleSendBestContinue(0.2)}
            />
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
