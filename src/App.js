import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
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
import { clearKvCache } from './api/swarmApi';
import AppHeader from './components/AppHeader';
import SwarmConfig from './components/SwarmConfig';
import ModelConverter from './components/ModelConverter';
import PressureCluster from './components/PressureCluster';
import PromptInput from './components/PromptInput';
import ConversationThread from './components/ConversationThread';
import FinalAnswerPanel from './components/FinalAnswerPanel';
import RagSources from './components/RagSources';
import MetricsStrip from './components/MetricsStrip';
import PipelineStageOutputs from './components/PipelineStageOutputs';
import AgentGrid from './components/AgentGrid';
import CompareVariantsPanel from './components/CompareVariantsPanel';
import HelpModal from './components/HelpModal';
import RagAdmin from './components/RagAdmin';
import CachePanel from './components/CachePanel';

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
    activeAgents, modes, activeMode, kvReadings, kvFetchFailed,
    flatPickAgent, setFlatPickAgent, refreshModes, refreshAgents, handleModeChange,
  } = useCoordinatorState(online);

  const { theme, setTheme } = useLayoutPreference();

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

  // Surface transport-level stream errors as toasts instead of an inline banner.
  useEffect(() => {
    if (error && error !== prevError.current) {
      const msg = error.includes('Coordinator offline')
        ? 'Swarm not running — open CONFIGURE and click LAUNCH SWARM.'
        : `ERROR: ${error}`;
      showToast(msg, 'error');
    }
    prevError.current = error;
  }, [error, showToast]);

  const excludedBreaker = lastMeta?.excluded_unhealthy || [];
  const stageOutputs = Array.isArray(lastMeta?.stage_outputs) ? lastMeta.stage_outputs : [];

  const recentHistory = useMemo(() => history.slice(-10).reverse(), [history]);

  const handleExpandProgrammer = useCallback((instruction) => handleSubmit(instruction, 0.2, {
    followup: true,
    contextPolicy: {
      include: ['original_prompt', 'final', 'programmer'],
      target_agent: 'programmer',
      max_context_chars: 24000,
    },
  }), [handleSubmit]);

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
        onToggleConfig={handleToggleConfig}
        onToggleHistory={handleToggleHistory}
        onOpenConverter={handleOpenConverter}
        onOpenRagAdmin={handleOpenRagAdmin}
        onOpenCachePanel={handleOpenCachePanel}
        onOpenHelp={handleOpenHelp}
        onSetTheme={setTheme}
      />

      {showConverter && (
        <div style={{ padding: '1rem 1.5rem', maxWidth: 860, margin: '0 auto' }}>
          <ModelConverter standalone />
        </div>
      )}

      {!showConverter && showConfigPanel && <SwarmConfig onDeployed={handleDeployed} />}

      {showHistory && history.length > 0 && (
        <div className="history-dropdown">
          {recentHistory.map((entry, index) => (
            <div key={entry._run_id || entry.timestamp || index} className="history-item" onClick={() => handleHistorySelect(entry)}>
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
            onPromptConsumed={() => setSelectedPrompt(null)}
            canContinue={Boolean(currentSession?.sessionId)}
            onQualityPass={handleQualityPass}
            useRag={useRag}
            onUseRagChange={setUseRag}
            activeAgents={activeAgents}
            backend={backend}
            onBackendChange={switchBackend}
          />
          {excludedBreaker.length > 0 && (
            <div className="dispatch-hint-banner dispatch-hint-banner--breaker" role="status">
              Skipped (circuit breaker open):{' '}
              <strong>{excludedBreaker.join(', ')}</strong>. Cooldown ~30s after failures — see PER-MODE ROSTER health or coordinator logs.
            </div>
          )}
          <ConversationThread
            history={history}
            sessionId={currentSession?.sessionId}
            responses={responses}
            finalAnswer={finalAnswer}
            loading={loading}
            pendingPrompt={pendingPrompt}
            onFollowUp={handleFollowUp}
            onClear={handleClearSession}
            onSwitchSession={handleSwitchSession}
          />
          <FinalAnswerPanel text={finalAnswer} />
          <RagSources rag={lastMeta?.rag} />
          <MetricsStrip envelope={{ meta: lastMeta }} />
          <PipelineStageOutputs stageOutputs={stageOutputs} />
          <AgentGrid
            activeAgents={activeAgents}
            responses={responses}
            agentErrors={agentErrors}
            loading={loading}
            timings={lastMeta?.timings || {}}
            onSaveCode={handleSaveCode}
            flatPickMode={activeMode === 'flat'}
            pickedFlatAgent={flatPickAgent}
            onPickFlatAgent={setFlatPickAgent}
            onExpandProgrammer={handleExpandProgrammer}
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
