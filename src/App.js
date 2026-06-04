import React, { useState } from 'react';
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
import { useAppCoreState } from './hooks/useAppCoreState';
import { useLayoutPreference } from './hooks/useLayoutPreference';
import { useSwarmPolling } from './hooks/useSwarmPolling';
import { useSubmitHandlers } from './hooks/useSubmitHandlers';
import { useSessionHandlers } from './hooks/useSessionHandlers';
import { useAppLayoutProps } from './hooks/useAppLayoutProps';
import { useAppHandlers } from './hooks/useAppHandlers';
import { useAppCallbacks } from './hooks/useAppCallbacks';
import { useTokenBudget } from './hooks/useTokenBudget';
import { useAgentHealth } from './hooks/useAgentHealth';

import { LAYOUTS } from './layouts/registry';
import BrewlateLayout from './layouts/BrewlateLayout';

function App() {
  const showToast = useToast();

  const {
    responses, agentErrors, finalAnswer, loading, error, history, online,
    submit, loadHistory, checkStatus,
    setResponses, setFinalAnswer, lastMeta, setLastMeta,
    currentSession, setCurrentSession, backend, switchBackend,
    activeAgents, modes, activeMode, kvReadings, kvFetchFailed, hostMemory,
    flatPickAgent, setFlatPickAgent, modeWarnings, refreshModes, refreshAgents, handleModeChange,
    memoryPressure,
    showConfig, setShowConfig, deployPending, setDeployPending,
    showHelp, setShowHelp, showConverter, setShowConverter,
    showRagAdmin, setShowRagAdmin, showCachePanel, setShowCachePanel,
    cacheStatus, setCacheStatus, useRag, setUseRag, warningsByModeWithMemory,
  } = useAppCoreState({ showToast });

  const { layout, theme, setLayout, setTheme } = useLayoutPreference();

  useSwarmPolling({ checkStatus, loadHistory, refreshAgents, refreshModes, online });

  const {
    showHistory, setShowHistory,
    selectedPrompt, setSelectedPrompt,
    selectedTemperature,
    handleHistorySelect, handleSwitchSession, handleClearSession,
  } = useSessionHandlers({ setResponses, setFinalAnswer, setLastMeta, setCurrentSession, history });

  const { onModeWarning, onMemoryPressureWarning, onSaveCodeToast } = useAppCallbacks({ showToast });

  const handleForked = ({ fork_session_id }) => {
    if (fork_session_id) setCurrentSession({ sessionId: fork_session_id });
  };

  const { byName: agentHealthByName } = useAgentHealth({ online });
  const [qualityPassTarget, setQualityPassTarget] = useState(null);

  const {
    pendingPrompt, handleSubmit, handleQualityPass,
    handleFollowUp, handleSendBestContinue, handleSaveCode,
  } = useSubmitHandlers({
    submit, loadHistory, currentSession, activeMode, useRag,
    responses, activeAgents, flatPickAgent, modeWarnings, memoryPressure, hostMemory,
    kvReadings,
    agentHealthByName,
    qualityPassTarget,
    onModeWarning, onSaveCodeToast, onMemoryPressureWarning,
  });

  const {
    handleToggleConfig, handleToggleHistory,
    handleOpenConverter, handleOpenRagAdmin, handleOpenCachePanel, handleOpenHelp,
    handleDeployed, handleClearCache, handleExpandProgrammer,
  } = useAppHandlers({
    checkStatus, refreshAgents, loadHistory, showToast,
    setShowConfig, setShowConverter, setShowHistory,
    setShowHelp, setShowRagAdmin, setShowCachePanel,
    setDeployPending, setCacheStatus, handleSubmit,
  });

  const { overrun: budgetExhausted } = useTokenBudget({
    sessionId: currentSession?.sessionId,
    online,
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
    setSelectedPrompt, handleFollowUp, handleClearSession, handleSwitchSession, handleForked,
    handleSaveCode, setFlatPickAgent, handleSendBestContinue, setUseRag,
    handleExpandProgrammer,
    setShowHelp, setShowRagAdmin, setShowCachePanel,
    budgetExhausted,
    qualityPassTarget, setQualityPassTarget,
  });

  const Layout = LAYOUTS[layout]?.component ?? BrewlateLayout;
  return <Layout {...layoutProps} />;
}

export default App;
