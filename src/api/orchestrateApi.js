import { API_BASE } from './base';

/**
 * Persist an orchestrate run into the coordinator's shared history
 * so it appears in the conversation thread alongside streaming runs.
 */
export async function saveOrchestrateHistory({ prompt, result, mode, sessionId, temperature = 0.2 }) {
  try {
    const res = await fetch(`${API_BASE}/api/history/entry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, result, mode, session_id: sessionId, temperature }),
    });
    if (!res.ok) {
      console.error('[orchestrate] history save failed:', res.status);
    }
  } catch (err) {
    console.error('[orchestrate] history save network error:', err);
  }
}

/**
 * POST /api/orchestrate/stream — SSE streaming for Python orchestration modes.
 * callbacks: { onToken(agentId, text), onAgentDone(agentId), onDone(meta), onError(agentId, msg) }
 * Returns a cancel function.
 */
export function submitOrchestrateStream(mode, prompt, params = {}, opts = {}, callbacks = {}) {
  const { onToken, onAgentStart, onAgentDone, onDone, onError } = callbacks;
  const controller = new AbortController();

  const body = { mode, prompt, params };
  if (opts.useRag) {
    body.use_rag = true;
    if (opts.ragTopK) body.rag_top_k = opts.ragTopK;
    if (typeof opts.ragMinScore === 'number') body.rag_min_score = opts.ragMinScore;
  }

  (async () => {
    let res;
    try {
      res = await fetch(`${API_BASE}/api/orchestrate/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('[orchestrate/stream] fetch failed:', err);
        onError?.(null, err.message);
      }
      return;
    }
    if (!res.ok) {
      const msg = await res.text().catch(() => `HTTP ${res.status}`);
      console.error('[orchestrate/stream] non-ok response:', msg);
      onError?.(null, msg);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let doneFired = false;
    const fireOnce = (meta) => { if (!doneFired) { doneFired = true; onDone?.(meta); } };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) { fireOnce({}); break; }
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
          else if (eventName === 'agent_start') onAgentStart?.(data.agent_id, data.meta);
          else if (eventName === 'agent_end') onAgentDone?.(data.agent_id);
          else if (eventName === 'done') fireOnce(data);
          else if (eventName === 'error') {
            console.error('[orchestrate/stream] error:', data);
            onError?.(data.agent_id ?? null, data.error ?? String(data));
          }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('[orchestrate/stream] read error:', err);
        onError?.(null, err.message);
      }
    }
  })();

  return () => controller.abort();
}

/** Split text into n roughly equal word-boundary chunks. */
export function splitIntoChunks(text, n) {
  const words = text.trim().split(/\s+/);
  if (words.length === 0 || n < 1) return [text];
  const size = Math.ceil(words.length / n);
  const chunks = [];
  for (let i = 0; i < words.length; i += size) {
    const chunk = words.slice(i, i + size).join(' ');
    if (chunk) chunks.push(chunk);
  }
  return chunks;
}

/**
 * POST /api/orchestrate — blocking JSON call to the Python mode dispatcher.
 * Returns { result, session_id, mode, meta }.
 * opts: { useRag, ragTopK, ragMinScore } — forwarded for server-side RAG retrieval.
 */
export async function submitOrchestrate(mode, prompt, params = {}, opts = {}) {
  const body = { mode, prompt, params };
  if (opts.useRag) {
    body.use_rag = true;
    if (opts.ragTopK) body.rag_top_k = opts.ragTopK;
    if (typeof opts.ragMinScore === 'number') body.rag_min_score = opts.ragMinScore;
  }
  let res;
  try {
    res = await fetch(`${API_BASE}/api/orchestrate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error('[orchestrate] network error:', err);
    throw new Error(`Orchestrate network error: ${err.message}`);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = body.error || `orchestrate HTTP ${res.status}`;
    console.error('[orchestrate] server error:', msg);
    throw new Error(msg);
  }
  return res.json();
}
