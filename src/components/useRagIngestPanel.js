import { useEffect, useRef, useState } from 'react';
import { ragIngestUpload, ragIngestJob } from '../api/swarmApi';
import { POLL_MS, TERMINAL } from './ragAdminFormat';

export default function useRagIngestPanel({ onIndexed }) {
  const [uploads, setUploads] = useState([]);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

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
            console.error('[rag-ingest] poll failed:', err);
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
        if (anyTerminal) onIndexed?.();
      } catch (err) {
        console.error('[rag-ingest] poll tick failed:', err);
      }
    }, POLL_MS);
    return () => clearInterval(id);
  }, [uploads, onIndexed]);

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
          if (mountedRef.current) {
            setUploads(prev => prev.map(u =>
              u === entry ? { ...u, jobId, source_path, status: 'queued' } : u,
            ));
          }
        } catch (err) {
          console.error('[rag-ingest] upload failed:', err);
          if (mountedRef.current) {
            setUploads(prev => prev.map(u =>
              u === entry ? { ...u, status: 'error', error: err.message } : u,
            ));
          }
        }
      }
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  return { uploads, busy, fileRef, onPick, onFiles };
}
