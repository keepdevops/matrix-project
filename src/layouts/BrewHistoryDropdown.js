import React, { useMemo } from 'react';

export default function BrewHistoryDropdown({ history, onHistorySelect }) {
  const recentHistory = useMemo(() => history.slice(-10).reverse(), [history]);

  return (
    <div className="brew-history-dropdown">
      {recentHistory.map((entry, index) => (
        <div
          key={entry._run_id || entry.timestamp || index}
          className="history-item brew-history-item"
          onClick={() => onHistorySelect(entry)}
          onKeyDown={(e) => { if (e.key === 'Enter') onHistorySelect(entry); }}
          role="button"
          tabIndex={0}
        >
          <span className="history-prompt">
            {entry.prompt?.substring(0, 50)}{entry.prompt?.length > 50 ? '...' : ''}
          </span>
          <span className="history-time">
            {entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : ''}
          </span>
        </div>
      ))}
    </div>
  );
}
