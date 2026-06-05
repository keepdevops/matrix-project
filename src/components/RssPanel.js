import React, { useCallback, useEffect, useRef, useState } from 'react';
import { fetchRssFeed } from '../api/rssApi';

const CATEGORY_LABELS = {
  history:            'History',
  config:             'Config',
  'token-regulation': 'Token Regulation',
};
const POLL_MS = 15000;

function formatDate(pubDate) {
  if (!pubDate) return '';
  try {
    return new Date(pubDate).toLocaleTimeString();
  } catch {
    return pubDate;
  }
}

export default function RssPanel() {
  const [category, setCategory]   = useState('token-regulation');
  const [items, setItems]         = useState([]);
  const [status, setStatus]       = useState('idle');
  const [lastAt, setLastAt]       = useState(null);
  const timerRef = useRef(null);

  const load = useCallback(async (cat) => {
    setStatus('loading');
    try {
      const data = await fetchRssFeed(cat);
      setItems(data);
      setLastAt(new Date().toLocaleTimeString());
      setStatus(data.length === 0 ? 'empty' : 'ok');
    } catch (e) {
      console.error('[RssPanel] fetch error', e);
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    load(category);
    timerRef.current = setInterval(() => load(category), POLL_MS);
    return () => clearInterval(timerRef.current);
  }, [category, load]);

  return (
    <div className="rss-panel">
      <div className="rss-panel-header">
        <span className="rss-panel-title">RSS FEEDS</span>
        <div className="rss-panel-tabs">
          {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
            <button
              key={key}
              className={`rss-tab${category === key ? ' rss-tab--active' : ''}`}
              onClick={() => setCategory(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="rss-panel-meta">
          {status === 'loading' ? 'loading…' : lastAt ? `@ ${lastAt}` : ''}
        </span>
      </div>

      {status === 'error' && (
        <div className="rss-panel-notice">
          <strong>{CATEGORY_LABELS[category]}</strong> feed unavailable — coordinator unreachable or RSS disabled.
        </div>
      )}
      {status === 'empty' && (
        <div className="rss-panel-notice">
          No <strong>{CATEGORY_LABELS[category]}</strong> events yet. Enable <code>coordinator.rss.enabled</code> to start publishing.
        </div>
      )}

      {items.length > 0 && (
        <ul className="rss-item-list">
          {items.map((item, i) => (
            <li key={i} className="rss-item">
              <span className="rss-item-time">{formatDate(item.pubDate)}</span>
              <span className="rss-item-title">{item.title}</span>
              {item.description && (
                <span className="rss-item-desc">{item.description}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
