import React from 'react';
import Button from './Button';
import { fmtBytes, fmtTime } from './ragAdminFormat';
import { useRagAdmin } from './useRagAdmin';

function RagAdmin({ onClose }) {
  const {
    health, docs, docsError, uploads, busy, fileRef,
    refresh, onPick, onFiles, onDelete, statusColor, statusText,
  } = useRagAdmin();

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
          <Button variant="ghost" size="xs" className="help-close" onClick={onClose}>✕</Button>
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
