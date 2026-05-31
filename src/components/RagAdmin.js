import React, { useCallback, useEffect, useState } from 'react';
import Button from './Button';
import { ragIngestHealth } from '../api/swarmApi';
import RagIngestPanel from './RagIngestPanel';
import RagManagePanel from './RagManagePanel';

const TABS = [
  ['ingest', 'Upload'],
  ['manage', 'Indexed'],
];

function RagAdmin({ onClose }) {
  const [health, setHealth] = useState({ loading: true });
  const [tab, setTab] = useState('ingest');
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const h = await ragIngestHealth();
      if (!cancelled) setHealth({ loading: false, ...h });
    })();
    return () => { cancelled = true; };
  }, []);

  const onIndexed = useCallback(() => {
    setRefreshToken(t => t + 1);
  }, []);

  const statusColor = health.loading ? '#888' : health.ok ? '#3fb950' : '#f85149';
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
          <Button variant="ghost" size="xs" className="help-close" onClick={onClose}>✕</Button>
        </div>
        <div className="help-body">
          <div className="brew-right-tabs" style={{ marginBottom: '0.75rem' }}>
            {TABS.map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`brew-right-tab${tab === id ? ' active' : ''}`}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === 'ingest' && (
            <RagIngestPanel ingestOk={health.ok} onIndexed={onIndexed} />
          )}
          {tab === 'manage' && (
            <RagManagePanel refreshToken={refreshToken} />
          )}
        </div>
      </div>
    </div>
  );
}

export default RagAdmin;
