import { useState, useMemo, useEffect, useRef } from 'react';

export function useAppState({ error, showToast, activeMode, modeWarnings, memoryPressure, warningsByMode }) {
  const [showConfig, setShowConfig]         = useState(true);
  const [deployPending, setDeployPending]   = useState(false);
  const [showHelp, setShowHelp]             = useState(false);
  const [showConverter, setShowConverter]   = useState(false);
  const [showRagAdmin, setShowRagAdmin]     = useState(false);
  const [showCachePanel, setShowCachePanel] = useState(false);
  const [cacheStatus, setCacheStatus]       = useState('idle');
  const [useRag, setUseRag]                 = useState(false);

  const warningsByModeWithMemory = useMemo(() => {
    if (!memoryPressure?.warnings?.length || !activeMode) return warningsByMode;
    const memHints = memoryPressure.warnings.slice(0, 2);
    const existing = warningsByMode[activeMode] ?? [];
    return { ...warningsByMode, [activeMode]: [...existing, ...memHints] };
  }, [warningsByMode, memoryPressure, activeMode]);

  const prevErrorRef = useRef(null);
  useEffect(() => {
    if (error && error !== prevErrorRef.current) {
      const msg = error.includes('Coordinator offline')
        ? 'Swarm not running — open CONFIGURE and launch the swarm.'
        : `ERROR: ${error}`;
      showToast(msg, 'error');
    }
    prevErrorRef.current = error;
  }, [error, showToast]);

  return {
    showConfig, setShowConfig,
    deployPending, setDeployPending,
    showHelp, setShowHelp,
    showConverter, setShowConverter,
    showRagAdmin, setShowRagAdmin,
    showCachePanel, setShowCachePanel,
    cacheStatus, setCacheStatus,
    useRag, setUseRag,
    warningsByModeWithMemory,
  };
}
