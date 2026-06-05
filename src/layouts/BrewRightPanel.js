import React from 'react';
import ModeRosterPanel from '../components/ModeRosterPanel';
import PresetsPanel from '../components/PresetsPanel';
import BrewPreviewPanel from './BrewPreviewPanel';
import BrewSessionTab from './BrewSessionTab';
import BrewAgentsTab from './BrewAgentsTab';
import BrewBroadcastTab from './BrewBroadcastTab';
import BrewRagTab from './BrewRagTab';
import BrewMonitorPopout from './BrewMonitorPopout';

const RIGHT_TABS = [
  ['session',  'Session'],
  ['agents',   'Agents'],
  ['modes',    'Modes'],
  ['brewcast', 'Live'],
  ['rag',      'RAG'],
];

export default function BrewRightPanel({
  deployed,
  rightTab,
  onTabChange,
  preview,
  session,
  agents,
  broadcast,
  rag,
  rolesByName,
  monitor,
}) {
  return (
    <div className="brew-panel brew-panel--right">
      <div className="brew-panel-header">
        <span className="brew-panel-title">{deployed ? 'Session' : 'Live Preview'}</span>
        {deployed && monitor && (
          <div className="brew-panel-header-actions">
            <button
              type="button"
              className={`brew-monitor-trigger${monitor.showMonitor ? ' open' : ''}${monitor.online ? ' online' : ''}`}
              onClick={() => monitor.setShowMonitor(v => !v)}
              aria-expanded={monitor.showMonitor}
              title="KV cache and port pressure"
            >
              <span className={`brew-monitor-trigger-dot${monitor.online ? ' online' : ''}`} />
              MONITOR
            </button>
          </div>
        )}
      </div>

      {deployed && monitor && (
        <BrewMonitorPopout
          open={monitor.showMonitor} onClose={() => monitor.setShowMonitor(false)}
          online={monitor.online} kvReadings={monitor.kvReadings} kvFetchFailed={monitor.kvFetchFailed}
          activeAgents={monitor.activeAgents} engine={monitor.engine} excludedBreaker={monitor.excludedBreaker}
          cacheStatus={monitor.cacheStatus} onClearCache={monitor.onClearCache}
        />
      )}

      {!deployed ? (
        <BrewPreviewPanel {...preview} />
      ) : (
        <div className="brew-chat-panel">
          <div className="brew-right-tabs">
            {RIGHT_TABS.map(([id, label]) => (
              <button key={id} type="button"
                className={`brew-right-tab${rightTab === id ? ' active' : ''}`}
                onClick={() => onTabChange(id)}
              >{label}</button>
            ))}
          </div>

          {rightTab === 'session' && <BrewSessionTab {...session} />}
          {rightTab === 'agents' && <BrewAgentsTab {...agents} rolesByName={rolesByName} />}
          {rightTab === 'modes' && (
            <div className="brew-modes-tab brew-modes-scroll">
              <ModeRosterPanel />
              <PresetsPanel />
            </div>
          )}
          {rightTab === 'brewcast' && <BrewBroadcastTab {...broadcast} rolesByName={rolesByName} />}
          {rightTab === 'rag' && <BrewRagTab {...rag} />}
        </div>
      )}
    </div>
  );
}
