import React from 'react';
import MetricsStrip from '../components/MetricsStrip';
import ModelConverter from '../components/ModelConverter';
import PressureCluster from '../components/PressureCluster';
import SwarmConfig from '../components/SwarmConfig';

export default function SidebarLayoutSidebar({
  collapsed, onToggle,
  online, kvReadings, kvFetchFailed,
  showConverter, showConfigPanel, onDeployed,
  showHistory, history, onHistorySelect,
  lastMeta,
}) {
  return (
    <aside className="sl-sidebar">
      <button
        className="sl-collapse-btn"
        onClick={onToggle}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed ? '›' : '‹'}
      </button>

      {!collapsed && (
        <>
          <div className="sl-sidebar-section">
            <PressureCluster online={online} readings={kvReadings} fetchFailed={kvFetchFailed} />
          </div>

          {showConverter && (
            <div className="sl-sidebar-section">
              <ModelConverter standalone />
            </div>
          )}

          {!showConverter && showConfigPanel && (
            <div className="sl-sidebar-section sl-sidebar-section--config">
              <SwarmConfig onDeployed={onDeployed} />
            </div>
          )}

          {showHistory && history.length > 0 && (
            <div className="sl-sidebar-section">
              <div className="sl-sidebar-label">History</div>
              {history.slice(-10).reverse().map((entry, i) => (
                <div key={i} className="history-item" onClick={() => onHistorySelect(entry)}>
                  <span className="history-prompt">
                    {entry.prompt?.substring(0, 40)}{entry.prompt?.length > 40 ? '…' : ''}
                  </span>
                  <span className="history-time">
                    {entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : ''}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="sl-sidebar-section">
            <MetricsStrip envelope={{ meta: lastMeta }} />
          </div>
        </>
      )}
    </aside>
  );
}
