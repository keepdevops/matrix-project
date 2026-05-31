import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ragIngestUpload,
  ragIngestJob,
  ragIngestList,
  ragIngestDelete,
  ragIngestHealth,
} from '../api/swarmApi';
import { POLL_MS, TERMINAL } from './ragAdminFormat';

export function useRagAdmin() {
  const [health, setHealth] = useState({ loading: true });
  const [docs, setDocs] = useState([]);
  const [docsError, setDocsError] = useState(null);
  const [uploads, setUploads] = useState([]);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const refresh = useCallback(async () => {
    if (!mountedRef.current) return;
    setDocsError(null);
    try {
      const data = await ragIngestList();
      if (mountedRef.current) setDocs(Array.isArray(data.documents) ? data.documents : []);
    } catch (err) {
      console.error('[rag-admin] list failed:', err);
      if (mountedRef.current) setDocsError(err.message || 'list failed');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const h = await ragIngestHealth();
      if (!cancelled && mountedRef.current) setHealth({ loading: false, ...h });
    })();
    refresh();
    return () => { cancelled = true; };
  }, [refresh]);

  useEffect(() => {
    const pending = uploads.filter(u => u.jobId && !TERMINAL.has(u.status));
    if (pending.length === 0) return undefined;
    const id = setInterval(async () => {
      try {
        const updates = await Promise.all(pending.map(async u => {
          try {
            const j = await ragIngestJob(u.jobId);
            return { jobId: u.jobId, status: j.status, chunks: j.chunks, error: j.error };
          } catch (err) {
            console.error('[rag-admin] poll failed:', err);
            return { jobId: u.jobId, status: 'error', error: err.message };
          }
        }));
        let anyTerminal = false;
        setUploads(prev => prev.map(u => {
          const upd = updates.find(x => x.jobId === u.jobId);
          if (!upd) return u;
          if (TERMINAL.has(upd.status)) anyTerminal = true;
          return { ...u, ...upd };
        }));
        if (anyTerminal) refresh();
      } catch (err) {
        console.error('[rag-admin] setInterval tick failed:', err);
      }
    }, POLL_MS);
    return () => clearInterval(id);
  }, [uploads, refresh]);

  const onPick = () => fileRef.current?.click();

  const onFiles = async (files) => {
    const list = Array.from(files || []);
    if (list.length === 0) return;
    setBusy(true);
    try {
      for (const f of list) {
        const entry = { name: f.name, size: f.size, status: 'uploading' };
        setUploads(prev => [entry, ...prev]);
        try {
          const { job_id: jobId, source_path } = await ragIngestUpload(f);
          if (mountedRef.current) setUploads(prev => prev.map(u =>
            u === entry ? { ...u, jobId, source_path, status: 'queued' } : u,
          ));
        } catch (err) {
          console.error('[rag-admin] upload failed:', err);
          if (mountedRef.current) setUploads(prev => prev.map(u =>
            u === entry ? { ...u, status: 'error', error: err.message } : u,
          ));
        }
      }
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  const onDelete = async (source) => {
    if (!window.confirm(`Remove all chunks for ${source}?`)) return;
    try {
      await ragIngestDelete(source);
      await refresh();
    } catch (err) {
      console.error('[rag-admin] delete failed:', err);
      window.alert(`Delete failed: ${err.message}`);
    }
  };

  const statusColor = health.loading ? '#888'
    : health.ok ? '#3fb950' : '#f85149';
  const statusText = health.loading ? 'checking ingest…'
    : health.ok ? `ingest ok (embedder: ${health.embedder || 'unknown'})`
      : `ingest unavailable${health.error ? `: ${health.error}` : ''}`;

  return {
    health, docs, docsError, uploads, busy, fileRef,
    refresh, onPick, onFiles, onDelete, statusColor, statusText,
  };
}
