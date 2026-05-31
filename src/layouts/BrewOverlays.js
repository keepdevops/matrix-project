import React from 'react';
import AgentPromptModal from '../components/AgentPromptModal';
import HelpModal from '../components/HelpModal';
import RagAdmin from '../components/RagAdmin';
import CachePanel from '../components/CachePanel';
import ModelConverter from '../components/ModelConverter';
import BrewAgentPopout from './BrewAgentPopout';

export default function BrewOverlays({
  editingAgent,
  setEditingAgent,
  setRoles,
  showConverter,
  onOpenConverter,
  showHelp,
  onCloseHelp,
  activeAgents,
  showRagAdmin,
  onCloseRagAdmin,
  showCachePanel,
  onCloseCachePanel,
  leftPopout,
  setLeftPopout,
}) {
  return (
    <>
      {editingAgent && (
        <AgentPromptModal
          agent={editingAgent}
          defaultPrompt={editingAgent.system_prompt}
          onClose={() => setEditingAgent(null)}
          onSaved={(saved) => {
            const next = typeof saved === 'string' ? { system_prompt: saved } : (saved || {});
            setRoles(prev => prev.map(r =>
              r.name === editingAgent.name ? { ...r, ...next } : r
            ));
            setEditingAgent(null);
          }}
        />
      )}

      {showConverter && (
        <div className="brew-modal-overlay" onClick={onOpenConverter} role="presentation">
          <div className="brew-modal-panel" onClick={e => e.stopPropagation()} role="dialog" aria-label="GGUF to MLX converter">
            <div className="brew-modal-panel-header">
              <h2 className="brew-modal-panel-title">GGUF → MLX</h2>
              <button type="button" className="brew-header-btn" onClick={onOpenConverter}>✕</button>
            </div>
            <div className="brew-converter"><ModelConverter standalone /></div>
          </div>
        </div>
      )}

      {showHelp && <HelpModal onClose={onCloseHelp} agents={activeAgents} />}
      {showRagAdmin && <RagAdmin onClose={onCloseRagAdmin} />}
      {showCachePanel && <CachePanel onClose={onCloseCachePanel} />}
      {leftPopout && (
        <BrewAgentPopout
          name={leftPopout.name} model={leftPopout.model} meta={leftPopout.meta}
          response={leftPopout.response} error={leftPopout.error}
          code={leftPopout.code} language={leftPopout.language}
          onClose={() => setLeftPopout(null)}
        />
      )}
    </>
  );
}
