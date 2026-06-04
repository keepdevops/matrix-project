import { API_BASE, MLX_API_BASE } from './base';
import { buildStreamBody, fetchSseStream, readSseStream } from './sseStreamReader';

function dispatchStreamEvent(eventName, dataStr, callbacks) {
  const { onToken, onAgentDone, onSelected, onStage, onSynthesisStart, onMetrics, onRouting, onError, onSession } = callbacks;
  let data;
  try { data = JSON.parse(dataStr); } catch { data = dataStr; }
  if (eventName === 'token') onToken?.(data.agent, data.delta);
  else if (eventName === 'agent_done') onAgentDone?.(data.agent);
  else if (eventName === 'selected') onSelected?.(data);
  else if (eventName === 'stage') onStage?.(data);
  else if (eventName === 'synthesis_start') onSynthesisStart?.(data.agent);
  else if (eventName === 'session') onSession?.(data);
  else if (eventName === 'metrics') onMetrics?.(data);
  else if (eventName === 'routing') onRouting?.(data);  // MS-161 Phase C
  else if (eventName === 'error') { console.error('[stream] agent error:', data); onError?.(data.agent, data.error); }
}

function dispatchMlxEvent(eventName, dataStr, callbacks) {
  const { onToken, onAgentDone, onSelected, onStage, onSynthesisStart, onMetrics, onRouting, onError, onSession } = callbacks;
  let data;
  try { data = JSON.parse(dataStr); } catch { data = dataStr; }
  if (eventName === 'token') onToken?.(data.agent_id ?? data.agent, data.text ?? data.delta);
  else if (eventName === 'agent_end' || eventName === 'agent_done') onAgentDone?.(data.agent_id ?? data.agent);
  else if (eventName === 'selected') onSelected?.(data);
  else if (eventName === 'stage') onStage?.(data);
  else if (eventName === 'synthesis_start') onSynthesisStart?.(data.agent_id ?? data.agent);
  else if (eventName === 'session') onSession?.(data);
  else if (eventName === 'metrics') onMetrics?.(data);
  else if (eventName === 'routing') onRouting?.(data);  // MS-161 Phase C
  else if (eventName === 'error') { console.error('[mlx-stream] error:', data); onError?.(data.agent_id ?? data.agent, data.error); }
}

/**
 * Submit a prompt via SSE streaming. Calls back on each event as agents respond.
 * callbacks: { onToken, onAgentDone, onSelected, onStage, onSynthesisStart, onMetrics, onDone, onError, onSession }
 * Returns a cancel function.
 */
export function submitPromptStream(prompt, temperature = 0.2, opts = {}, callbacks = {}) {
  const controller = new AbortController();
  const body = buildStreamBody(prompt, temperature, opts);
  (async () => {
    try {
      const streamBody = await fetchSseStream(
        `${API_BASE}/architect/stream`, body, controller.signal, '[stream]');
      await readSseStream(streamBody, {
        logPrefix: '[stream]',
        onDone: callbacks.onDone,
        onTes: callbacks.onTes,
        onReadError: (err) => callbacks.onError?.(null, err.message),
        dispatchEvent: (ev, data) => dispatchStreamEvent(ev, data, callbacks),
      });
    } catch (err) {
      if (err.name !== 'AbortError') { console.error('[stream] fetch failed:', err); callbacks.onError?.(null, err.message); }
    }
  })();
  return () => controller.abort();
}

/**
 * Submit a prompt to the Python MLX coordinator via SSE streaming.
 * Drop-in replacement for submitPromptStream when backend="mlx".
 */
export function submitPromptStreamMlx(prompt, temperature = 0.2, opts = {}, callbacks = {}) {
  const controller = new AbortController();
  const body = buildStreamBody(prompt, temperature, opts,
    opts.params ? { params: opts.params } : {});
  (async () => {
    try {
      const streamBody = await fetchSseStream(
        `${MLX_API_BASE}/stream`, body, controller.signal, '[mlx-stream]');
      await readSseStream(streamBody, {
        logPrefix: '[mlx-stream]',
        onDone: callbacks.onDone,
        onTes: callbacks.onTes,
        onReadError: (err) => callbacks.onError?.(null, err.message),
        dispatchEvent: (ev, data) => dispatchMlxEvent(ev, data, callbacks),
      });
    } catch (err) {
      if (err.name !== 'AbortError') { console.error('[mlx-stream] fetch failed:', err); callbacks.onError?.(null, err.message); }
    }
  })();
  return () => controller.abort();
}
