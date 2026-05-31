import React, { useCallback, useEffect, useRef, useState } from 'react';
import Button from './Button';
import { ragIngestList, ragIngestDelete } from '../api/swarmApi';
import { fmtTime } from './ragAdminFormat';

export default function RagManagePanel({ refreshToken = 0 }) {
  const [docs, setDocs] = useState([]);
  const [docsError, setDocsError] = useState(null);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const refresh = useCallback(async () => {
    if (!mountedRef.current) return;
    setDocsError(null);
    try {
      const data = await ragIngestList();
      if (mountedRef.current) setDocs(Array.isArray(data.documents) ? data.documents : []);
    } catch (err) {
      console.error('[rag-manage] list failed:', err);
      if (mountedRef.current) setDocsError(err.message || 'list failed');
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh, refreshToken]);

  const onDelete = async (source) => {
    if (!window.confirm(`Remove all chunks for ${source}?`)) return;
    try {
      await ragIngestDelete(source);
      await refresh();
    } catch (err) {
      console.error('[rag-manage] delete failed:', err);
      window.alert(`Delete failed: ${err.message}`);
    }
  };

  return (
    <div className="help-section">
      <h3>Indexed documents</h3>
      {docsError && (
        <div style={{ color: '#f85149', marginBottom: '0.5rem' }}>{docsError}</div>
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
                <td title={d.source_path} style={{ wordBreak: 'break-all' }}>{d.source_path}</td>
                <td>{d.chunks}</td>
                <td>{fmtTime(d.latest)}</td>
                <td>
                  <Button variant="outline-error" size="xs" onClick={() => onDelete(d.source_path)}>
                    DELETE
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Button variant="ghost" size="sm" onClick={refresh} style={{ marginTop: '0.5rem' }}>
        REFRESH
      </Button>
    </div>
  );
}
