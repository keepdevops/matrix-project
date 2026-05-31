import React, { useCallback, useMemo, useState } from 'react';
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
import { useAppLayoutProps } from './hooks/useAppLayoutProps';
import { useAppPanelHandlers } from './hooks/useAppPanelHandlers';
import { LAYOUTS } from './layouts/registry';
import BrewlateLayout from './layouts/BrewlateLayout';

function App() {
  const showToast = useToast();

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

  const {
    handleToggleConfig, handleToggleHistory, handleOpenConverter,
    handleOpenRagAdmin, handleOpenCachePanel, handleOpenHelp,
    handleDeployed, handleClearCache, handleExpandProgrammer,
  } = useAppPanelHandlers({
    showToast, error, checkStatus, refreshAgents, loadHistory, handleSubmit,
    setShowConfig, setShowHistory, setShowConverter, setShowRagAdmin,
    setShowCachePanel, setShowHelp, setDeployPending, setCacheStatus,
  });

  const excludedBreaker = lastMeta?.excluded_unhealthy || [];
  const stageOutputs = Array.isArray(lastMeta?.stage_outputs) ? lastMeta.stage_outputs : [];

  const layoutProps = useAppLayoutProps({
    online, activeAgents, modes, activeMode, kvReadings, kvFetchFailed, hostMemory,
    responses, agentErrors, finalAnswer, loading, error, history, lastMeta,
    currentSession, backend, switchBackend,
    showConfig, showHistory, showConfigPanel, deployPending,
    showHelp, showConverter, showRagAdmin, showCachePanel, cacheStatus, useRag,
    flatPickAgent, excludedBreaker, stageOutputs,
    warningsByModeWithMemory, memoryPressure, theme, layout,
    pendingPrompt, selectedPrompt, selectedTemperature,
    handleModeChange, handleClearCache,
    handleToggleConfig, handleToggleHistory, handleOpenConverter,
    handleOpenRagAdmin, handleOpenCachePanel, handleOpenHelp,
    setTheme, setLayout, handleDeployed,
    handleHistorySelect, handleSubmit, handleQualityPass,
    setSelectedPrompt, handleFollowUp, handleClearSession, handleSwitchSession,
    handleSaveCode, setFlatPickAgent, handleSendBestContinue, setUseRag,
    handleExpandProgrammer,
    setShowHelp, setShowRagAdmin, setShowCachePanel,
  });

  const Layout = LAYOUTS[layout]?.component ?? BrewlateLayout;
  return <Layout {...layoutProps} />;
}

export default App;
