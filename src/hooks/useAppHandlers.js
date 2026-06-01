import { useCallback, useRef } from 'react';
import { clearKvCache } from '../api/swarmApi';

export function useAppHandlers({
  checkStatus, refreshAgents, loadHistory, showToast,
  setShowConfig, setShowConverter, setShowHistory,
  setShowHelp, setShowRagAdmin, setShowCachePanel,
  setDeployPending, setCacheStatus,
  handleSubmit,
}) {
  const mountedRef = useRef(true);

  const handleToggleConfig   = useCallback(() => { setShowConverter(false); setShowConfig(v => !v); }, [setShowConverter, setShowConfig]);
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
    setTimeout(() => {
      if (mountedRef.current) { clearInterval(pollId); setDeployPending(false); }
    }, 90000);
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

  const handleExpandProgrammer = useCallback((instruction) => handleSubmit(instruction, 0.2, {
    followup: true,
    contextPolicy: {
      include: ['original_prompt', 'final', 'programmer'],
      target_agent: 'programmer',
      max_context_chars: 24000,
    },
  }), [handleSubmit]);

  return {
    mountedRef,
    handleToggleConfig, handleToggleHistory,
    handleOpenConverter, handleOpenRagAdmin, handleOpenCachePanel, handleOpenHelp,
    handleDeployed, handleClearCache, handleExpandProgrammer,
  };
}
