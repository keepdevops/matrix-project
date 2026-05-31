import { useCallback, useEffect, useRef } from 'react';
import { clearKvCache } from '../api/swarmApi';

/** Panel toggles, deploy polling, cache clear, and error toast wiring for App shell. */
export function useAppPanelHandlers({
  showToast,
  error,
  checkStatus,
  refreshAgents,
  loadHistory,
  handleSubmit,
  setShowConfig,
  setShowHistory,
  setShowConverter,
  setShowRagAdmin,
  setShowCachePanel,
  setShowHelp,
  setDeployPending,
  setCacheStatus,
}) {
  const prevError = useRef(null);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const handleToggleConfig   = useCallback(() => { setShowConverter(false); setShowConfig(v => !v); }, [setShowConfig, setShowConverter]);
  const handleToggleHistory  = useCallback(() => setShowHistory(v => !v), [setShowHistory]);
  const handleOpenConverter  = useCallback(() => setShowConverter(v => !v), [setShowConverter]);
  const handleOpenRagAdmin   = useCallback(() => setShowRagAdmin(true), [setShowRagAdmin]);
  const handleOpenCachePanel = useCallback(() => setShowCachePanel(true), [setShowCachePanel]);
  const handleOpenHelp       = useCallback(() => setShowHelp(true), [setShowHelp]);

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
  }, [checkStatus, refreshAgents, loadHistory, showToast, setShowConfig, setDeployPending]);

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
  }, [showToast, setCacheStatus]);

  useEffect(() => {
    if (error && error !== prevError.current) {
      const msg = error.includes('Coordinator offline')
        ? 'Swarm not running — open CONFIGURE and launch the swarm.'
        : `ERROR: ${error}`;
      showToast(msg, 'error');
    }
    prevError.current = error;
  }, [error, showToast]);

  const handleExpandProgrammer = useCallback((instruction) => handleSubmit(instruction, 0.2, {
    followup: true,
    contextPolicy: {
      include: ['original_prompt', 'final', 'programmer'],
      target_agent: 'programmer',
      max_context_chars: 24000,
    },
  }), [handleSubmit]);

  return {
    handleToggleConfig,
    handleToggleHistory,
    handleOpenConverter,
    handleOpenRagAdmin,
    handleOpenCachePanel,
    handleOpenHelp,
    handleDeployed,
    handleClearCache,
    handleExpandProgrammer,
  };
}
