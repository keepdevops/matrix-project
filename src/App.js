import React, { useMemo } from 'react';
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
import { useAppHandlers } from './hooks/useAppHandlers';
import { useAppState } from './hooks/useAppState';
import { useAppCallbacks } from './hooks/useAppCallbacks';
import { LAYOUTS } from './layouts/registry';
import BrewlateLayout from './layouts/BrewlateLayout';

function App() {
  const showToast = useToast();

  const {
    responses, agentErrors, finalAnswer, loading, error, history, online,
    submit, loadHistory, checkStatus,
    setResponses, setFinalAnswer, lastMeta, setLastMeta,
    currentSession, setCurrentSession, backend, switchBackend,
  } = useSwarm();

  const {
    activeAgents, modes, activeMode, kvReadings, kvFetchFailed, hostMemory,
    flatPickAgent, setFlatPickAgent, modeWarnings, refreshModes, refreshAgents, handleModeChange,
  } = useCoordinatorState(online);

  const warningsByMode = useMemo(
    () => (activeMode && modeWarnings.length > 0 ? { [activeMode]: modeWarnings } : {}),
    [activeMode, modeWarnings]
  );
  const memoryPressure = useMemoryPressure({ online, activeAgents, activeMode, kvReadings, hostMemory });

  const {
    showConfig, setShowConfig, deployPending, setDeployPending,
    showHelp, setShowHelp, showConverter, setShowConverter,
    showRagAdmin, setShowRagAdmin, showCachePanel, setShowCachePanel,
    cacheStatus, setCacheStatus, useRag, setUseRag, warningsByModeWithMemory,
  } = useAppState({ error, showToast, activeMode, modeWarnings, memoryPressure, warningsByMode });

  const { layout, theme, setLayout, setTheme } = useLayoutPreference();

  useSwarmPolling({ checkStatus, loadHistory, refreshAgents, refreshModes, online });

  const {
    showHistory, setShowHistory,
    selectedPrompt, setSelectedPrompt,
    selectedTemperature,
    handleHistorySelect, handleSwitchSession, handleClearSession,
  } = useSessionHandlers({ setResponses, setFinalAnswer, setLastMeta, setCurrentSession, history });

  const { onModeWarning, onMemoryPressureWarning, onSaveCodeToast } = useAppCallbacks({ showToast });

  const {
    pendingPrompt, handleSubmit, handleQualityPass,
    handleFollowUp, handleSendBestContinue, handleSaveCode,
  } = useSubmitHandlers({
    submit, loadHistory, currentSession, activeMode, useRag,
    responses, activeAgents, flatPickAgent, modeWarnings, memoryPressure, hostMemory,
    onModeWarning,
    onSaveCodeToast,
    onMemoryPressureWarning,
  });

  const {
    mountedRef,
    handleToggleConfig, handleToggleHistory,
    handleOpenConverter, handleOpenRagAdmin, handleOpenCachePanel, handleOpenHelp,
    handleDeployed, handleClearCache, handleExpandProgrammer,
  } = useAppHandlers({
    checkStatus, refreshAgents, loadHistory, showToast,
    setShowConfig, setShowConverter, setShowHistory,
    setShowHelp, setShowRagAdmin, setShowCachePanel,
    setDeployPending, setCacheStatus, handleSubmit,
  });

  const showConfigPanel = showConfig || (!online && !deployPending && activeAgents.length === 0);
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
