import React, { useCallback, useEffect, useState } from 'react';
import './App.css';
import './themes/light.css';
import { useSwarm } from './hooks/useSwarm';
import { useCoordinatorState } from './hooks/useCoordinatorState';
import { useLayoutPreference } from './hooks/useLayoutPreference';
import { clearKvCache } from './api/swarmApi';
import { LAYOUTS } from './layouts/registry';
import { extractCodeBlock } from './utils/codeExtractor';
import { qualityPassContextPolicy } from './utils/qualityPassContext';

const METADATA_KEYS = new Set(['prompt', 'temperature', 'timestamp', '_final', '_mode', '_session_id', '_run_id']);

function App() {
  const {
    responses, finalAnswer, loading, error, history, online,
    submit, loadHistory, checkStatus,
    setResponses, setFinalAnswer, lastMeta, setLastMeta,
    currentSession, setCurrentSession,
    backend, switchBackend,
  } = useSwarm();

  const {
    activeAgents, modes, activeMode, kvReadings, kvFetchFailed,
    flatPickAgent, setFlatPickAgent, refreshModes, refreshAgents, handleModeChange,
  } = useCoordinatorState(online);

  const { layout, theme, setLayout, setTheme } = useLayoutPreference();

  const [showHistory, setShowHistory]       = useState(false);
  const [showConfig, setShowConfig]         = useState(true);
  const [deployPending, setDeployPending]   = useState(false);
  const [showHelp, setShowHelp]             = useState(false);
  const [showConverter, setShowConverter]   = useState(false);
  const [showRagAdmin, setShowRagAdmin]     = useState(false);
  const [showCachePanel, setShowCachePanel] = useState(false);
  const [selectedPrompt, setSelectedPrompt]           = useState(null);
  const [selectedTemperature, setSelectedTemperature] = useState(null);
  const [cacheStatus, setCacheStatus] = useState('idle');
  const [useRag, setUseRag]           = useState(false);
  const [pendingPrompt, setPendingPrompt] = useState(null);

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
    setPendingPrompt(prompt);
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
    } finally {
      setPendingPrompt(null);
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

  const handleFollowUp = async (text, contextPolicy) => {
    await handleSubmit(text, 0.5, { followup: true, contextPolicy });
    loadHistory();
  };

  const handleSwitchSession = useCallback((sessionId) => {
    const entries = history.filter(e => e._session_id === sessionId);
    if (!entries.length) return;
    const last = entries[entries.length - 1];
    setCurrentSession({ sessionId, runId: last._run_id });
    setResponses({});
    setFinalAnswer(last._final || null);
    setLastMeta(null);
  }, [history, setCurrentSession, setResponses, setFinalAnswer, setLastMeta]);

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

  const LayoutComponent = (LAYOUTS[layout] ?? LAYOUTS.default).component;

  return (
    <LayoutComponent
      // coordinator
      online={online} activeAgents={activeAgents} modes={modes} activeMode={activeMode}
      kvReadings={kvReadings} kvFetchFailed={kvFetchFailed}
      // swarm
      responses={responses} finalAnswer={finalAnswer} loading={loading} error={error}
      history={history} lastMeta={lastMeta} currentSession={currentSession}
      backend={backend} switchBackend={switchBackend}
      // ui state
      showConfig={showConfig} showHistory={showHistory}
      showConfigPanel={showConfigPanel} deployPending={deployPending}
      showHelp={showHelp} showConverter={showConverter}
      showRagAdmin={showRagAdmin} showCachePanel={showCachePanel}
      cacheStatus={cacheStatus} useRag={useRag} pendingPrompt={pendingPrompt}
      flatPickAgent={flatPickAgent}
      excludedBreaker={lastMeta?.excluded_unhealthy || []}
      stageOutputs={Array.isArray(lastMeta?.stage_outputs) ? lastMeta.stage_outputs : []}
      selectedPrompt={selectedPrompt} selectedTemperature={selectedTemperature}
      // theme + layout
      theme={theme} layout={layout} onSetTheme={setTheme} onSetLayout={setLayout}
      // handlers
      onModeChange={handleModeChange}
      onClearCache={handleClearCache}
      onToggleConfig={() => setShowConfig(v => !v)}
      onToggleHistory={() => setShowHistory(v => !v)}
      onOpenConverter={() => setShowConverter(v => !v)}
      onOpenRagAdmin={() => setShowRagAdmin(v => !v)}
      onOpenCachePanel={() => setShowCachePanel(v => !v)}
      onOpenHelp={() => setShowHelp(v => !v)}
      onDeployed={handleDeployed}
      onHistorySelect={handleHistorySelect}
      onSubmit={handleSubmit}
      onQualityPass={handleQualityPass}
      onPromptConsumed={() => setSelectedPrompt(null)}
      onFollowUp={handleFollowUp}
      onClearSession={() => { setCurrentSession(null); setResponses({}); setFinalAnswer(null); setLastMeta(null); }}
      onSwitchSession={handleSwitchSession}
      onSaveCode={handleSaveCode}
      onPickFlatAgent={setFlatPickAgent}
      onSendBestContinue={handleSendBestContinue}
      onUseRagChange={setUseRag}
    />
  );
}

export default App;
