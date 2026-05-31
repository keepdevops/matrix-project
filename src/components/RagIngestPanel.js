import React, { useEffect, useRef, useState } from 'react';
import Button from './Button';
import { ragIngestUpload, ragIngestJob } from '../api/swarmApi';
import { fmtBytes, POLL_MS, TERMINAL } from './ragAdminFormat';

export default function RagIngestPanel({ ingestOk, onIndexed }) {
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

  return (
    <div className="help-section">
      <h3>Upload</h3>
      <div
        onDragOver={e => { e.preventDefault(); }}
        onDrop={e => {
          e.preventDefault();
          onFiles(e.dataTransfer?.files);
        }}
        style={{
          border: '1px dashed #555',
          borderRadius: 6,
          padding: '1rem',
          textAlign: 'center',
          opacity: ingestOk ? 1 : 0.5,
        }}
      >
        <input
          ref={fileRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          onChange={e => onFiles(e.target.files)}
        />
        <Button variant="primary" size="sm" onClick={onPick} disabled={busy || !ingestOk}>
          CHOOSE FILES
        </Button>
        <div style={{ marginTop: '0.4rem', opacity: 0.7, fontSize: '0.85rem' }}>
          or drop files here · max 25 MB · text/code allowlist
        </div>
      </div>

      {uploads.length > 0 && (
        <table style={{ width: '100%', marginTop: '0.75rem', fontSize: '0.85rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', opacity: 0.7 }}>
              <th>file</th><th>size</th><th>status</th><th>chunks</th>
            </tr>
          </thead>
          <tbody>
            {uploads.map((u, i) => (
              <tr key={`${u.name}-${i}`}>
                <td title={u.source_path}>{u.name}</td>
                <td>{fmtBytes(u.size)}</td>
                <td title={u.error || ''} style={{ color: u.status === 'error' ? '#f85149' : undefined }}>
                  {u.status}{u.error ? ' ⚠' : ''}
                </td>
                <td>{u.chunks ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
