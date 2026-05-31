import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import './styles/responsive.css';
import './themes/light.css';
import './themes/overdrive.css';
import './themes/synthwave.css';
import './themes/cobalt.css';
import './themes/greyscale.css';
import './themes/cvd-blue-orange.css';
import './themes/cvd-teal-charcoal.css';
import './themes/cvd-amber.css';
import './themes/cvd-light-blue-orange.css';
import './themes/cvd-light-tritanopia.css';
import './themes/cvd-light-amber.css';
import { useToast } from './components/ToastManager';
import { useSwarm } from './hooks/useSwarm';
import { useCoordinatorState } from './hooks/useCoordinatorState';
import { useLayoutPreference } from './hooks/useLayoutPreference';
import { useSwarmPolling } from './hooks/useSwarmPolling';
import { useSubmitHandlers } from './hooks/useSubmitHandlers';
import { useSessionHandlers } from './hooks/useSessionHandlers';
import { useMemoryPressure } from './hooks/useMemoryPressure';
import { clearKvCache } from './api/swarmApi';
import { LAYOUTS } from './layouts/registry';
import BrewlateLayout from './layouts/BrewlateLayout';

function App() {
  const showToast = useToast();
  const prevError = useRef(null);

  const {
    responses, agentErrors, finalAnswer, loading, error, history, online,
    submit, loadHistory, checkStatus,
    setResponses, setFinalAnswer, lastMeta, setLastMeta,
    currentSession, setCurrentSession,
    backend, switchBackend,
  } = useSwarm();

  const {
    activeAgents, modes, activeMode, kvReadings, kvFetchFailed, hostMemory,
    flatPickAgent, setFlatPickAgent, modeWarnings, refreshModes, refreshAgents, handleModeChange,
  } = useCoordinatorState(online);

  const warningsByMode = useMemo(
    () => (activeMode && modeWarnings.length > 0 ? { [activeMode]: modeWarnings } : {}),
    [activeMode, modeWarnings]
  );

  const memoryPressure = useMemoryPressure({
    online, activeAgents, activeMode, kvReadings, hostMemory,
  });

  const warningsByModeWithMemory = useMemo(() => {
    if (!memoryPressure?.warnings?.length || !activeMode) return warningsByMode;
    const memHints = memoryPressure.warnings.slice(0, 2);
    const existing = warningsByMode[activeMode] ?? [];
    return { ...warningsByMode, [activeMode]: [...existing, ...memHints] };
  }, [warningsByMode, memoryPressure, activeMode]);

  const { layout, theme, setLayout, setTheme } = useLayoutPreference();

  const [showConfig, setShowConfig]         = useState(true);
  const [deployPending, setDeployPending]   = useState(false);
  const [showHelp, setShowHelp]             = useState(false);
  const [showConverter, setShowConverter]   = useState(false);
  const [showRagAdmin, setShowRagAdmin]     = useState(false);
  const [showCachePanel, setShowCachePanel] = useState(false);
  const [cacheStatus, setCacheStatus]       = useState('idle');
  const [useRag, setUseRag]                 = useState(false);

  useSwarmPolling({ checkStatus, loadHistory, refreshAgents, refreshModes, online });

  const {
    showHistory, setShowHistory,
    selectedPrompt, setSelectedPrompt,
    selectedTemperature,
    handleHistorySelect, handleSwitchSession, handleClearSession,
  } = useSessionHandlers({ setResponses, setFinalAnswer, setLastMeta, setCurrentSession, history });

  const {
    pendingPrompt, handleSubmit, handleQualityPass,
    handleFollowUp, handleSendBestContinue, handleSaveCode,
  } = useSubmitHandlers({
    submit, loadHistory, currentSession, activeMode, useRag,
    responses, activeAgents, flatPickAgent,
    modeWarnings,
    memoryPressure,
    hostMemory,
    onModeWarning: useCallback((warnings) => {
      showToast(warnings[0], 'warn');
    }, [showToast]),
    onSaveCodeToast: showToast,
    onMemoryPressureWarning: useCallback((pressure) => {
      const msg = pressure.warnings[0] || 'Elevated memory pressure';
      const hint = pressure.suggestFlatMode
        ? ' — try flat mode or SAFE profile'
        : pressure.suggestSafeProfile
          ? ' — try SAFE profile in CONFIGURE'
          : '';
      showToast(`${msg}${hint}`, 'warn');
    }, [showToast]),
  });

  const showConfigPanel = showConfig || (!online && !deployPending && activeAgents.length === 0);

  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const handleToggleConfig   = useCallback(() => { setShowConverter(false); setShowConfig(v => !v); }, []);
  const handleToggleHistory  = useCallback(() => setShowHistory(v => !v), []);
  const handleOpenConverter  = useCallback(() => setShowConverter(v => !v), []);
  const handleOpenRagAdmin   = useCallback(() => setShowRagAdmin(true), []);
  const handleOpenCachePanel = useCallback(() => setShowCachePanel(true), []);
  const handleOpenHelp       = useCallback(() => setShowHelp(true), []);

  const handleDeployed = useCallback(() => {
    setShowConfig(false);
    setDeployPending(true);
    showToast('Swarm launching — waiting for health check…', 'info');
    const pollId = setInterval(async () => {
      const isOnline = await checkStatus();
      if (!mountedRef.current) { clearInterval(pollId); return; }
      if (isOnline) {
        clearInterval(pollId);
        setDeployPending(false);
        refreshAgents();
        loadHistory();
        showToast('Swarm online', 'success');
      }
    }, 2000);
    setTimeout(() => { if (mountedRef.current) { clearInterval(pollId); setDeployPending(false); } }, 90000);
  }, [checkStatus, refreshAgents, loadHistory, showToast]);

  const handleClearCache = useCallback(async () => {
    setCacheStatus('clearing');
    try {
      await clearKvCache();
      setCacheStatus('cleared');
      showToast('KV cache cleared', 'success');
    } catch {
      setCacheStatus('failed');
      showToast('Cache clear failed', 'error');
    } finally {
      setTimeout(() => setCacheStatus('idle'), 2000);
    }
  }, [showToast]);

  useEffect(() => {
    if (error && error !== prevError.current) {
      const msg = error.includes('Coordinator offline')
        ? 'Swarm not running — open CONFIGURE and launch the swarm.'
        : `ERROR: ${error}`;
      showToast(msg, 'error');
    }
    prevError.current = error;
  }, [error, showToast]);

  const excludedBreaker = lastMeta?.excluded_unhealthy || [];
  const stageOutputs = Array.isArray(lastMeta?.stage_outputs) ? lastMeta.stage_outputs : [];

  const handleExpandProgrammer = useCallback((instruction) => handleSubmit(instruction, 0.2, {
    followup: true,
    contextPolicy: {
      include: ['original_prompt', 'final', 'programmer'],
      target_agent: 'programmer',
      max_context_chars: 24000,
    },
  }), [handleSubmit]);

  const layoutProps = useMemo(() => ({
    online,
    activeAgents,
    modes,
    activeMode,
    kvReadings,
    kvFetchFailed,
    hostMemory,
    responses,
    agentErrors,
    finalAnswer,
    loading,
    error,
    history,
    lastMeta,
    currentSession,
    backend,
    switchBackend,
    showConfig,
    showHistory,
    showConfigPanel,
    deployPending,
    showHelp,
    showConverter,
    showRagAdmin,
    showCachePanel,
    cacheStatus,
    useRag,
    flatPickAgent,
    excludedBreaker,
    stageOutputs,
    warningsByMode: warningsByModeWithMemory,
    memoryPressure,
    theme,
    layout,
    pendingPrompt,
    selectedPrompt,
    selectedTemperature,
    onModeChange: handleModeChange,
    onClearCache: handleClearCache,
    onToggleConfig: handleToggleConfig,
    onToggleHistory: handleToggleHistory,
    onOpenConverter: handleOpenConverter,
    onOpenRagAdmin: handleOpenRagAdmin,
    onOpenCachePanel: handleOpenCachePanel,
    onOpenHelp: handleOpenHelp,
    onCloseHelp: () => setShowHelp(false),
    onCloseRagAdmin: () => setShowRagAdmin(false),
    onCloseCachePanel: () => setShowCachePanel(false),
    onSetTheme: setTheme,
    onSetLayout: setLayout,
    onDeployed: handleDeployed,
    onHistorySelect: handleHistorySelect,
    onSubmit: handleSubmit,
    onQualityPass: handleQualityPass,
    onPromptConsumed: () => setSelectedPrompt(null),
    onFollowUp: handleFollowUp,
    onClearSession: handleClearSession,
    onSwitchSession: handleSwitchSession,
    onSaveCode: handleSaveCode,
    onPickFlatAgent: setFlatPickAgent,
    onSendBestContinue: handleSendBestContinue,
    onUseRagChange: setUseRag,
    onExpandProgrammer: handleExpandProgrammer,
  }), [
    online, activeAgents, modes, activeMode, kvReadings, kvFetchFailed, hostMemory,
    responses, agentErrors, finalAnswer, loading, error, history, lastMeta,
    currentSession, backend, switchBackend, showConfig, showHistory, showConfigPanel,
    deployPending, showHelp, showConverter, showRagAdmin, showCachePanel, cacheStatus,
    useRag, flatPickAgent, excludedBreaker, stageOutputs, warningsByModeWithMemory, memoryPressure, theme, layout,
    pendingPrompt, selectedPrompt, selectedTemperature, handleModeChange, handleClearCache,
    handleToggleConfig, handleToggleHistory, handleOpenConverter, handleOpenRagAdmin,
    handleOpenCachePanel, handleOpenHelp, setTheme, setLayout, handleDeployed,
    handleHistorySelect, handleSubmit, handleQualityPass, handleFollowUp, handleClearSession,
    handleSwitchSession, handleSaveCode, handleSendBestContinue, handleExpandProgrammer,
  ]);

  const Layout = LAYOUTS[layout]?.component ?? BrewlateLayout;
  return <Layout {...layoutProps} />;
}

export default App;
