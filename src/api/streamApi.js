import { API_BASE, MLX_API_BASE, normalizeArchitectResponse } from './base';
import { buildStreamBody, fetchSseStream, readSseStream } from './sseStreamReader';

/**
 * Submit a prompt via SSE streaming. Calls back on each event as agents respond.
 * callbacks: { onToken, onAgentDone, onSelected, onStage, onSynthesisStart, onMetrics, onDone, onError }
 * Returns a cancel function.
 */
export function submitPromptStream(prompt, temperature = 0.2, opts = {}, callbacks = {}) {
  const {
    onToken, onAgentDone, onSelected, onStage, onSynthesisStart, onMetrics, onDone, onError, onSession,
  } = callbacks;
  const controller = new AbortController();
  const body = buildStreamBody(prompt, temperature, opts);

  (async () => {
    try {
      const streamBody = await fetchSseStream(
        `${API_BASE}/architect/stream`, body, controller.signal, '[stream]');
      await readSseStream(streamBody, {
        logPrefix: '[stream]',
        onDone,
        onReadError: (err) => onError?.(null, err.message),
        dispatchEvent: (eventName, dataStr) => {
          let data;
          try { data = JSON.parse(dataStr); } catch { data = dataStr; }
          if (eventName === 'token') onToken?.(data.agent, data.delta);
          else if (eventName === 'agent_done') onAgentDone?.(data.agent);
          else if (eventName === 'selected') onSelected?.(data);
          else if (eventName === 'stage') onStage?.(data);
          else if (eventName === 'synthesis_start') onSynthesisStart?.(data.agent);
          else if (eventName === 'session') onSession?.(data);
          else if (eventName === 'metrics') onMetrics?.(data);
          else if (eventName === 'error') {
            console.error('[stream] agent error:', data);
            onError?.(data.agent, data.error);
          }
        },
      });
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('[stream] fetch failed:', err);
        onError?.(null, err.message);
      }
    }
  })();

  return () => controller.abort();
}

/**
 * Submit a prompt to the Python MLX coordinator via SSE streaming.
 * Drop-in replacement for submitPromptStream when backend="mlx".
 */
export function submitPromptStreamMlx(prompt, temperature = 0.2, opts = {}, callbacks = {}) {
  const {
    onToken, onAgentDone, onSelected, onStage, onSynthesisStart, onMetrics, onDone, onError, onSession,
  } = callbacks;
  const controller = new AbortController();
  const body = buildStreamBody(prompt, temperature, opts,
    opts.params ? { params: opts.params } : {});

  (async () => {
    try {
      const streamBody = await fetchSseStream(
        `${MLX_API_BASE}/stream`, body, controller.signal, '[mlx-stream]');
      await readSseStream(streamBody, {
        logPrefix: '[mlx-stream]',
        onDone,
        onReadError: (err) => onError?.(null, err.message),
        dispatchEvent: (eventName, dataStr) => {
          let data;
          try { data = JSON.parse(dataStr); } catch { data = dataStr; }
          if (eventName === 'token') onToken?.(data.agent_id ?? data.agent, data.text ?? data.delta);
          else if (eventName === 'agent_end' || eventName === 'agent_done') onAgentDone?.(data.agent_id ?? data.agent);
          else if (eventName === 'selected') onSelected?.(data);
          else if (eventName === 'stage') onStage?.(data);
          else if (eventName === 'synthesis_start') onSynthesisStart?.(data.agent_id ?? data.agent);
          else if (eventName === 'session') onSession?.(data);
          else if (eventName === 'metrics') onMetrics?.(data);
          else if (eventName === 'error') {
            console.error('[mlx-stream] error:', data);
            onError?.(data.agent_id ?? data.agent, data.error);
          }
        },
      });
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('[mlx-stream] fetch failed:', err);
        onError?.(null, err.message);
      }
    }
  })();

  return () => controller.abort();
}

/** Clear an MLX session cache. Pass sessionId to clear one, omit to clear all. */
export async function clearMlxSession(sessionId) {
  const body = sessionId ? { session_id: sessionId } : {};
  const res = await fetch(`${MLX_API_BASE}/session/clear`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`mlx session clear failed (${res.status})`);
  return res.json();
}

/** Submit a prompt to all agents via the coordinator (non-streaming). */
export async function submitPrompt(prompt, temperature = 0.2, opts = {}) {
  const body = buildStreamBody(prompt, temperature, opts);

  const response = await fetch(`${API_BASE}/architect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API error (${response.status}): ${errorText}`);
  }
  const raw = await response.json();
  return normalizeArchitectResponse(raw);
}
