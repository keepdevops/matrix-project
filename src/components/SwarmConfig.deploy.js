import { useState, useRef, useCallback, useEffect } from 'react';
import { runDeploy } from './SwarmConfig.deploy.launch';

// useDeploy — encapsulates the launch flow's local state machine.
// status transitions: idle → deploying → idle | error.
// agentStatuses: Map<agentName, 'pending'|'ready'|'error'>
export function useDeploy({ onDeployed }) {
  const [status, setStatus] = useState('idle');
  const [statusMsg, setStatusMsg] = useState('');
  const [logTail, setLogTail] = useState(null);
  const [agentStatuses, setAgentStatuses] = useState(new Map());
  const pollRef = useRef(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const reset = () => {
    stopPolling();
    setStatus('idle'); setStatusMsg(''); setLogTail(null); setAgentStatuses(new Map());
  };

  const deploy = (args) => runDeploy({
    ...args, setStatus, setStatusMsg, setLogTail, setAgentStatuses,
    pollRef, stopPolling, onDeployed,
  });

  return { status, statusMsg, logTail, agentStatuses, deploy, reset };
}
