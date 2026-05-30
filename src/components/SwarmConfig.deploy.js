import { useState, useRef, useCallback } from 'react';
import { configureSwarm, fetchLogs } from '../api/swarmApi';
import { fetchConfigureStatus } from '../api/configApi';

// useDeploy — encapsulates the launch flow's local state machine.
//
// Returned shape:
//   { status, statusMsg, logTail, agentStatuses, deploy, reset }
// where deploy(args) runs validation + configureSwarm + log-fetch.
// status transitions: idle → deploying → idle | error.
// agentStatuses: Map<agentName, 'pending'|'ready'|'error'>
export function useDeploy({ onDeployed }) {
  const [status, setStatus] = useState('idle');
  const [statusMsg, setStatusMsg] = useState('');
  const [logTail, setLogTail] = useState(null);
  const [agentStatuses, setAgentStatuses] = useState(new Map());
  const pollRef = useRef(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  // Build port → [agentName] from the layout passed to deploy().
  const buildPortAgentMap = (layout) => {
    const map = new Map();
    for (const server of layout) {
      map.set(server.port, server.agents || []);
    }
    return map;
  };

  const startPolling = useCallback((portAgentMap) => {
    // Seed all agents as pending.
    const initial = new Map();
    for (const names of portAgentMap.values())
      for (const name of names) initial.set(name, 'pending');
    setAgentStatuses(initial);

    pollRef.current = setInterval(async () => {
      const data = await fetchConfigureStatus();
      if (!data) return;
      setAgentStatuses(prev => {
        const next = new Map(prev);
        for (const [portStr, state] of Object.entries(data.ports)) {
          const port = Number(portStr);
          const names = portAgentMap.get(port) || [];
          for (const name of names) next.set(name, state);
        }
        return next;
      });
      if (!data.active) stopPolling();
    }, 2000);
  }, [stopPolling]);

  const reset = () => {
    stopPolling();
    setStatus('idle');
    setStatusMsg('');
    setLogTail(null);
    setAgentStatuses(new Map());
  };

  const deploy = async ({ roles, selected, roleModels, models, engine, riskEstimate, layout }) => {
    if (riskEstimate.blockedGroups.length > 0) {
      const blocked = riskEstimate.blockedGroups
        .map(g => `${g.modelLabel} (ctx ${g.effectiveCtx})`).join(', ');
      setStatus('error');
      setStatusMsg(
        `Launch blocked: projected OOM risk is too high for ${blocked}. ` +
        `Reduce heavy groups, lower context, or switch to SAFE profile.`
      );
      return;
    }
    if (riskEstimate.band.id === 'high') {
      const ok = window.confirm(
        `Projected OOM risk is HIGH (score ${riskEstimate.totalScore.toFixed(1)}). Continue anyway?`
      );
      if (!ok) return;
    }

    const agents = roles
      .filter(r => selected.has(r.name))
      .map(r => {
        const model = roleModels[r.name];
        if (!model) return null;
        const modelMeta = models.find(m => m.path === model);
        const backend = modelMeta?.backend || r.backend || r.engine;
        return backend ? { ...r, model, backend } : { ...r, model };
      })
      .filter(Boolean);

    if (agents.length === 0) {
      setStatus('error');
      setStatusMsg('Select a model for at least one agent');
      return;
    }

    setStatus('deploying');
    const engineLabel = engine === 'mlx' ? 'MLX'
      : engine === 'vllm' ? 'vLLM'
      : 'llama-server';
    setStatusMsg(`Starting ${engineLabel} servers... this may take up to 4 minutes on first load`);
    setLogTail(null);

    const portAgentMap = buildPortAgentMap(layout);
    startPolling(portAgentMap);

    try {
      await configureSwarm(agents);
      stopPolling();
      setStatus('idle');
      onDeployed?.();
    } catch (e) {
      stopPolling();
      setStatus('error');
      setStatusMsg(e.message);
      const ports = (e.failedPorts && e.failedPorts.length > 0)
        ? e.failedPorts
        : layout.map(s => s.port);
      if (ports.length > 0) {
        fetchLogs(ports)
          .then(({ logs }) => setLogTail(logs))
          .catch(() => setLogTail([]));
      }
    }
  };

  return { status, statusMsg, logTail, agentStatuses, deploy, reset };
}
