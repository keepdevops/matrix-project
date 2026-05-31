import React from 'react';
import ModeRosterPanel from '../components/ModeRosterPanel';
import PresetsPanel from '../components/PresetsPanel';
import BrewPreviewPanel from './BrewPreviewPanel';
import BrewSessionTab from './BrewSessionTab';
import BrewAgentsTab from './BrewAgentsTab';
import BrewBroadcastTab from './BrewBroadcastTab';
import BrewRagTab from './BrewRagTab';

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
}) {
  return (
    <div className="brew-panel brew-panel--right">
      <div className="brew-panel-header">
        <span className="brew-panel-title">{deployed ? 'Session' : 'Live Preview'}</span>
      </div>

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
