/** Shared SSE body builder and stream reader for architect + MLX endpoints. */

export function buildStreamBody(prompt, temperature, opts = {}, extra = {}) {
  const body = { prompt, temperature, ...extra };
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
  if (typeof opts.kvPressure === 'number' && Number.isFinite(opts.kvPressure))
    body.kv_pressure = opts.kvPressure;
  if (opts.ragRerank) body.rag_rerank = true;
  return body;
}

export async function readSseStream(body, { dispatchEvent, onDone, onTes, onReadError, logPrefix = '[stream]' }) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let doneFired = false;
  const fireOnce = () => { if (!doneFired) { doneFired = true; onDone?.(); } };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) { fireOnce(); break; }
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
        if (eventName === 'done') { fireOnce(); continue; }
        // MS-72: extract meta.tes from session/metrics events and emit via onTes
        if (onTes && (eventName === 'session' || eventName === 'metrics')) {
          try {
            const d = JSON.parse(dataStr);
            if (typeof d?.meta?.tes === 'number') onTes(d.meta.tes);
            else if (typeof d?.tes === 'number') onTes(d.tes);
          } catch { /* non-JSON event — ignore */ }
        }
        dispatchEvent(eventName, dataStr);
      }
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      console.error(`${logPrefix} read error:`, err);
      onReadError?.(err);
    }
  }
}

export async function fetchSseStream(url, body, signal, logPrefix) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => `HTTP ${res.status}`);
    console.error(`${logPrefix} non-ok response:`, msg);
    throw new Error(msg);
  }
  if (!res.body) {
    console.error(`${logPrefix} response has no body`);
    throw new Error('stream response has no body');
  }
  return res.body;
}
