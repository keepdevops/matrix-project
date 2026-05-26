import React, { useCallback, useEffect, useRef, useState } from 'react';
import Button from './Button';
import {
  ragIngestUpload,
  ragIngestJob,
  ragIngestList,
  ragIngestDelete,
  ragIngestHealth,
} from '../api/swarmApi';

const POLL_MS = 1000;
const TERMINAL = new Set(['done', 'error']);

function fmtBytes(n) {
  if (!Number.isFinite(n)) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function fmtTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function RagAdmin({ onClose }) {
  const [health, setHealth] = useState({ loading: true });
  const [docs, setDocs] = useState([]);
  const [docsError, setDocsError] = useState(null);
  const [uploads, setUploads] = useState([]); // [{name, size, jobId, status, chunks, error}]
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const refresh = useCallback(async () => {
    setDocsError(null);
    try {
      const data = await ragIngestList();
      setDocs(Array.isArray(data.documents) ? data.documents : []);
    } catch (err) {
      console.error('[rag-admin] list failed:', err);
      setDocsError(err.message || 'list failed');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const h = await ragIngestHealth();
      if (!cancelled) setHealth({ loading: false, ...h });
    })();
    refresh();
    return () => { cancelled = true; };
  }, [refresh]);

  // Poll any non-terminal uploads.
  useEffect(() => {
    const pending = uploads.filter(u => u.jobId && !TERMINAL.has(u.status));
    if (pending.length === 0) return undefined;
    const id = setInterval(async () => {
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
          setUploads(prev => prev.map(u =>
            u === entry ? { ...u, jobId, source_path, status: 'queued' } : u,
          ));
        } catch (err) {
          console.error('[rag-admin] upload failed:', err);
          setUploads(prev => prev.map(u =>
            u === entry ? { ...u, status: 'error', error: err.message } : u,
          ));
        }
      }
    } finally {
      setBusy(false);
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

  return (
    <div className="help-overlay" onClick={onClose}>
      <div className="help-modal" onClick={e => e.stopPropagation()}>
        <div className="help-header">
          <span>
            <span
              aria-label={statusText}
              title={statusText}
              style={{
                display: 'inline-block',
                width: '0.6rem', height: '0.6rem',
                borderRadius: '50%',
                backgroundColor: statusColor,
                marginRight: '0.4rem',
                verticalAlign: 'middle',
              }}
            />
            RAG Documents
          </span>
          <button className="help-close" onClick={onClose}>✕</button>
        </div>
        <div className="help-body">

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
                opacity: health.ok ? 1 : 0.5,
              }}
            >
              <input
                ref={fileRef}
                type="file"
                multiple
                style={{ display: 'none' }}
                onChange={e => onFiles(e.target.files)}
              />
              <Button
                variant="primary"
                size="sm"
                onClick={onPick}
                disabled={busy || !health.ok}
              >
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
                      <td title={u.error || ''}
                          style={{ color: u.status === 'error' ? '#f85149' : undefined }}>
                        {u.status}{u.error ? ' ⚠' : ''}
                      </td>
                      <td>{u.chunks ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="help-section">
            <h3>Indexed documents</h3>
            {docsError && (
              <div style={{ color: '#f85149', marginBottom: '0.5rem' }}>
                {docsError}
              </div>
            )}
            {docs.length === 0 && !docsError && (
              <div style={{ opacity: 0.7 }}>No documents yet.</div>
            )}
            {docs.length > 0 && (
              <table style={{ width: '100%', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ textAlign: 'left', opacity: 0.7 }}>
                    <th>source</th><th>chunks</th><th>indexed</th><th />
                  </tr>
                </thead>
                <tbody>
                  {docs.map(d => (
                    <tr key={d.source_path}>
                      <td title={d.source_path} style={{ wordBreak: 'break-all' }}>
                        {d.source_path}
                      </td>
                      <td>{d.chunks}</td>
                      <td>{fmtTime(d.latest)}</td>
                      <td>
                        <Button
                          variant="outline-error"
                          size="xs"
                          onClick={() => onDelete(d.source_path)}
                        >
                          DELETE
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={refresh}
              style={{ marginTop: '0.5rem' }}
            >
              REFRESH
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default RagAdmin;
