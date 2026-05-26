import { RAG_INGEST_BASE } from './base';

export async function ragIngestUpload(file) {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(`${RAG_INGEST_BASE}/ingest`, { method: 'POST', body: fd });
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`ingest failed (${res.status}): ${msg}`);
  }
  return res.json();
}

export async function ragIngestJob(jobId) {
  const res = await fetch(`${RAG_INGEST_BASE}/jobs/${encodeURIComponent(jobId)}`);
  if (!res.ok) throw new Error(`job lookup failed (${res.status})`);
  return res.json();
}

export async function ragIngestList() {
  const res = await fetch(`${RAG_INGEST_BASE}/documents`);
  if (!res.ok) throw new Error(`list failed (${res.status})`);
  return res.json();
}

export async function ragIngestDelete(sourcePath) {
  const url = `${RAG_INGEST_BASE}/documents?source=${encodeURIComponent(sourcePath)}`;
  const res = await fetch(url, { method: 'DELETE' });
  if (!res.ok) throw new Error(`delete failed (${res.status})`);
  return res.json();
}

export async function ragIngestHealth() {
  try {
    const res = await fetch(`${RAG_INGEST_BASE}/health`);
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return await res.json();
  } catch (err) {
    console.error('[rag-ingest] health failed:', err);
    return { ok: false, error: err?.message || 'unreachable' };
  }
}
