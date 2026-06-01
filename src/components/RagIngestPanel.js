import React from 'react';
import Button from './Button';
import { fmtBytes } from './ragAdminFormat';
import useRagIngestPanel from './useRagIngestPanel';

export default function RagIngestPanel({ ingestOk, onIndexed }) {
  const { uploads, busy, fileRef, onPick, onFiles } = useRagIngestPanel({ onIndexed });

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
