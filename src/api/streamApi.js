import { API_BASE, MLX_API_BASE, normalizeArchitectResponse } from './base';

/**
 * Submit a prompt via SSE streaming. Calls back on each event as agents respond.
 * callbacks: { onToken, onAgentDone, onSelected, onStage, onSynthesisStart, onDone, onError }
 * Returns a cancel function.
 */
export function submitPromptStream(prompt, temperature = 0.2, opts = {}, callbacks = {}) {
  const { onToken, onAgentDone, onSelected, onStage, onSynthesisStart, onDone, onError, onSession } = callbacks;
  const controller = new AbortController();

  const body = { prompt, temperature };
  if (opts.sessionId) body.session_id = opts.sessionId;
  if (opts.parentRunId) body.parent_run_id = opts.parentRunId;
  if (opts.followup) body.followup = true;
  if (opts.qualityPass) body.quality_pass = true;
  if (opts.contextPolicy) body.context_policy = opts.contextPolicy;
  if (opts.useRag) body.use_rag = true;
  if (opts.ragTopK) body.rag_top_k = opts.ragTopK;
  if (typeof opts.ragMinScore === 'number' && Number.isFinite(opts.ragMinScore))
    body.rag_min_score = opts.ragMinScore;
  if (Array.isArray(opts.ragAgents) && opts.ragAgents.length > 0)
    body.rag_agents = opts.ragAgents;

  (async () => {
    let res;
    try {
      res = await fetch(`${API_BASE}/architect/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('[stream] fetch failed:', err);
        onError?.(null, err.message);
      }
      return;
    }
    if (!res.ok) {
      const msg = await res.text().catch(() => `HTTP ${res.status}`);
      console.error('[stream] non-ok response:', msg);
      onError?.(null, msg);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    const dispatchEvent = (eventName, dataStr) => {
      let data;
      try { data = JSON.parse(dataStr); } catch { data = dataStr; }
      if (eventName === 'token') onToken?.(data.agent, data.delta);
      else if (eventName === 'agent_done') onAgentDone?.(data.agent);
      else if (eventName === 'selected') onSelected?.(data);
      else if (eventName === 'stage') onStage?.(data);
      else if (eventName === 'synthesis_start') onSynthesisStart?.(data.agent);
      else if (eventName === 'session') onSession?.(data);
      else if (eventName === 'done') onDone?.();
      else if (eventName === 'error') {
        console.error('[stream] agent error:', data);
        onError?.(data.agent, data.error);
      }
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) { onDone?.(); break; }
        buf += decoder.decode(value, { stream: true });
        const blocks = buf.split('\n\n');
        buf = blocks.pop();
        for (const block of blocks) {
          if (!block.trim()) continue;
          let eventName = 'message';
          let dataStr = '';
          for (const line of block.split('\n')) {
            if (line.startsWith('event: ')) eventName = line.slice(7).trim();
            else if (line.startsWith('data: ')) dataStr = line.slice(6);
          }
          dispatchEvent(eventName, dataStr);
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('[stream] read error:', err);
        onError?.(null, err.message);
      }
    }
  })();

  return () => controller.abort();
}

/**
 * Submit a prompt to the Python MLX coordinator via SSE streaming.
 * Drop-in replacement for submitPromptStream when backend="mlx".
 * callbacks: { onToken, onAgentDone, onDone, onError }
 */
export function submitPromptStreamMlx(prompt, temperature = 0.2, opts = {}, callbacks = {}) {
  const { onToken, onAgentDone, onDone, onError } = callbacks;
  const controller = new AbortController();

  const body = { prompt, temperature };
  if (opts.sessionId) body.session_id = opts.sessionId;
  if (opts.params) body.params = opts.params;

  (async () => {
    let res;
    try {
      res = await fetch(`${MLX_API_BASE}/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('[mlx-stream] fetch failed:', err);
        onError?.(null, err.message);
      }
      return;
    }
    if (!res.ok) {
      const msg = await res.text().catch(() => `HTTP ${res.status}`);
      console.error('[mlx-stream] non-ok response:', msg);
      onError?.(null, msg);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) { onDone?.(); break; }
        buf += decoder.decode(value, { stream: true });
        const blocks = buf.split('\n\n');
        buf = blocks.pop();
        for (const block of blocks) {
          if (!block.trim()) continue;
          let eventName = 'message';
          let dataStr = '';
          for (const line of block.split('\n')) {
            if (line.startsWith('event: ')) eventName = line.slice(7).trim();
            else if (line.startsWith('data: ')) dataStr = line.slice(6);
          }
          let data;
          try { data = JSON.parse(dataStr); } catch { data = dataStr; }
          if (eventName === 'token') onToken?.(data.agent_id, data.text);
          else if (eventName === 'agent_end') onAgentDone?.(data.agent_id);
          else if (eventName === 'done') onDone?.();
          else if (eventName === 'error') {
            console.error('[mlx-stream] error:', data);
            onError?.(data.agent_id, data.error);
          }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('[mlx-stream] read error:', err);
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
  const body = { prompt, temperature };
  if (opts.sessionId) body.session_id = opts.sessionId;
  if (opts.parentRunId) body.parent_run_id = opts.parentRunId;
  if (opts.followup) body.followup = true;
  if (opts.qualityPass) body.quality_pass = true;
  if (opts.contextPolicy) body.context_policy = opts.contextPolicy;
  if (opts.useRag) body.use_rag = true;
  if (opts.ragTopK) body.rag_top_k = opts.ragTopK;
  if (typeof opts.ragMinScore === 'number' && Number.isFinite(opts.ragMinScore))
    body.rag_min_score = opts.ragMinScore;
  if (Array.isArray(opts.ragAgents) && opts.ragAgents.length > 0)
    body.rag_agents = opts.ragAgents;

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
