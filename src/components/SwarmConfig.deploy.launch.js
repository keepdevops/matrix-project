import { configureSwarm, fetchLogs, fetchConfigureStatus } from '../api/swarmApi';
import { RAM_WARN_GB } from './SwarmConfig.risk';

export function buildPortAgentMap(layout) {
  const map = new Map();
  for (const server of layout) map.set(server.port, server.agents || []);
  return map;
}

export function startPollingPorts(portAgentMap, pollRef, setAgentStatuses, stopPolling) {
  const initial = new Map();
  for (const names of portAgentMap.values())
    for (const name of names) initial.set(name, 'pending');
  setAgentStatuses(initial);

  pollRef.current = setInterval(async () => {
    try {
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
    } catch (err) {
      console.error('[useDeploy] status poll failed:', err);
    }
  }, 2000);
}

export async function runDeploy({
  roles, selected, roleModels, models, engine, riskEstimate, layout,
  setStatus, setStatusMsg, setLogTail, setAgentStatuses,
  pollRef, stopPolling, onDeployed,
}) {
  if (riskEstimate.blockedGroups.length > 0) {
    const blocked = riskEstimate.blockedGroups
      .map(g => `${g.modelLabel} (ctx ${g.effectiveCtx})`).join(', ');
    setStatus('error');
    setStatusMsg(`Launch blocked: projected OOM risk is too high for ${blocked}. Reduce heavy groups, lower context, or switch to SAFE profile.`);
    return;
  }
  if (riskEstimate.liveRamHigh && riskEstimate.band.id !== 'high') {
    const ok = window.confirm(`Live host RAM is already ${riskEstimate.liveUsedGb?.toFixed(1)} GB — above the ${RAM_WARN_GB} GB warn threshold. Adding KV cache will increase pressure. Continue?`);
    if (!ok) return;
  }
  if (riskEstimate.band.id === 'high') {
    const ok = window.confirm(`Projected OOM risk is HIGH (~${riskEstimate.totalRamGb.toFixed(1)} GB). Continue anyway?`);
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
  const engineLabel = engine === 'mlx' ? 'MLX' : engine === 'vllm' ? 'vLLM' : 'llama-server';
  setStatusMsg(`Starting ${engineLabel} servers... this may take up to 4 minutes on first load`);
  setLogTail(null);

  const portAgentMap = buildPortAgentMap(layout);
  startPollingPorts(portAgentMap, pollRef, setAgentStatuses, stopPolling);

  try {
    await configureSwarm(agents);
    stopPolling();
    setStatus('idle');
    onDeployed?.();
  } catch (e) {
    stopPolling();
    setStatus('error');
    setStatusMsg(e.message);
    setAgentStatuses(new Map());
    const ports = (e.failedPorts && e.failedPorts.length > 0) ? e.failedPorts : layout.map(s => s.port);
    if (ports.length > 0) {
      fetchLogs(ports).then(({ logs }) => setLogTail(logs)).catch(() => setLogTail([]));
    }
  }
}
