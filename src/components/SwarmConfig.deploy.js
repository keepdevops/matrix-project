import { useState } from 'react';
import { configureSwarm, fetchLogs } from '../api/swarmApi';

// useDeploy — encapsulates the launch flow's local state machine.
//
// Returned shape:
//   { status, statusMsg, logTail, deploy, reset }
// where deploy(args) runs the full validation + configureSwarm + log-fetch
// sequence. status transitions: idle → deploying → idle | error.
//
// Pulled out of SwarmConfig.js so the parent stays focused on rendering and
// orchestration; the hook owns its three pieces of state and the side-effect
// chain that ties them together.
export function useDeploy({ onDeployed }) {
  const [status, setStatus] = useState('idle');
  const [statusMsg, setStatusMsg] = useState('');
  const [logTail, setLogTail] = useState(null);

  const reset = () => {
    setStatus('idle');
    setStatusMsg('');
    setLogTail(null);
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

    try {
      await configureSwarm(agents);
      setStatus('idle');
      onDeployed?.();
    } catch (e) {
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

  return { status, statusMsg, logTail, deploy, reset };
}
