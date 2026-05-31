import React, { useState, useEffect, useCallback, useMemo } from 'react';
import './brewlate.css';
import './brewlate-themes.css';
import { PROFILE_CUSTOM, PROFILE_SAFE, PROFILE_BALANCED, PROFILE_MAX, PROFILE_MIXED } from '../components/SwarmConfig.helpers';
import { useDeploy } from '../components/SwarmConfig.deploy';
import AgentPromptModal from '../components/AgentPromptModal';
import BrewHeader from './BrewHeader';
import BrewAgentPopout from './BrewAgentPopout';
import ModeRosterPanel from '../components/ModeRosterPanel';
import PresetsPanel from '../components/PresetsPanel';
import HelpModal from '../components/HelpModal';
import RagAdmin from '../components/RagAdmin';
import CachePanel from '../components/CachePanel';
import ModelConverter from '../components/ModelConverter';
import { useBrewConfig } from './useBrewConfig';
import BrewConfigPanel from './BrewConfigPanel';
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

export default function BrewlateLayout({
  online, activeAgents, modes, activeMode,
  kvReadings, kvFetchFailed, hostMemory,
  responses, agentErrors, finalAnswer, loading, error, history, lastMeta,
  currentSession, backend, switchBackend,
  showHistory, showHelp, showConverter, showRagAdmin, showCachePanel,
  cacheStatus, useRag, flatPickAgent, excludedBreaker, stageOutputs,
  warningsByMode, memoryPressure, theme, layout: currentLayout,
  pendingPrompt, selectedPrompt, selectedTemperature,
  onModeChange, onClearCache, onToggleHistory,
  onOpenConverter, onOpenRagAdmin, onOpenCachePanel, onOpenHelp,
  onCloseHelp, onCloseRagAdmin, onCloseCachePanel,
  onSetTheme, onSetLayout, onDeployed,
  onHistorySelect, onSubmit, onQualityPass, onPromptConsumed,
  onFollowUp, onClearSession, onSwitchSession,
  onSaveCode, onPickFlatAgent, onSendBestContinue, onUseRagChange,
  onExpandProgrammer,
}) {
  const [deployed, setDeployed]             = useState(false);
  const [rightTab, setRightTab]             = useState('session');
  const [showMonitor, setShowMonitor]       = useState(false);
  const [showAgentsPopout, setShowAgentsPopout] = useState(false);
  const [leftPopout, setLeftPopout]         = useState(null);

  useEffect(() => {
    if (loading) setRightTab('brewcast');
    else if (lastMeta) setRightTab('session');
  }, [loading, lastMeta]);

  const handleDeployedInternal = useCallback(() => {
    setDeployed(true);
    onDeployed?.();
  }, [onDeployed]);

  const { status, statusMsg, agentStatuses, deploy, reset } = useDeploy({ onDeployed: handleDeployedInternal });

  useEffect(() => {
    if (online && activeAgents.length > 0) setDeployed(true);
    else if (!online) setDeployed(false);
  }, [online, activeAgents.length]);

  const brewConfig = useBrewConfig({ online, activeAgents, hostMemory, activeMode });
  const { roles, setRoles, editingAgent, setEditingAgent, loadError, setLoadRetries, invalidateModelsCache } = brewConfig;

  const recentHistory = useMemo(() => history.slice(-10).reverse(), [history]);
  const rolesByName   = useMemo(() => Object.fromEntries(roles.map(r => [r.name, r])), [roles]);

  if (loadError) {
    return (
      <div className="layout-brewlate">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: '1rem', color: 'var(--brew-text-muted)' }}>
          <div style={{ fontSize: '0.85rem', color: 'var(--brew-accent)' }}>CONFIG UNAVAILABLE</div>
          <div style={{ fontSize: '0.72rem' }}>Start the proxy then retry.</div>
          <button
            onClick={() => { invalidateModelsCache(); setLoadRetries(r => r + 1); }}
            style={{ padding: '0.5rem 1rem', background: 'var(--brew-border)', border: 'none', borderRadius: 4, color: 'var(--brew-text)', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.72rem' }}
          >RETRY</button>
        </div>
      </div>
    );
  }

  return (
    <div className="layout-brewlate">
      <BrewHeader
        online={online} activeAgents={activeAgents} modes={modes} activeMode={activeMode}
        warningsByMode={warningsByMode} kvReadings={kvReadings} kvFetchFailed={kvFetchFailed}
        memoryPressure={memoryPressure} cacheStatus={cacheStatus} historyCount={history.length}
        deployed={deployed} theme={theme} layout={currentLayout}
        onModeChange={onModeChange} onClearCache={onClearCache} onToggleHistory={onToggleHistory}
        onOpenConverter={onOpenConverter} onOpenRagAdmin={onOpenRagAdmin}
        onOpenCachePanel={onOpenCachePanel} onOpenHelp={onOpenHelp}
        onSetTheme={onSetTheme} onSetLayout={onSetLayout}
        onShowConfigure={() => setDeployed(false)}
      />

      {showHistory && history.length > 0 && (
        <div className="brew-history-dropdown">
          {recentHistory.map((entry, index) => (
            <div
              key={entry._run_id || entry.timestamp || index}
              className="history-item brew-history-item"
              onClick={() => onHistorySelect(entry)}
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
      )}

      <div className="brew-body">
        <BrewConfigPanel
          {...brewConfig}
          status={status} statusMsg={statusMsg} agentStatuses={agentStatuses}
          deploy={deploy} reset={reset}
          showMonitor={showMonitor} setShowMonitor={setShowMonitor}
          showAgentsPopout={showAgentsPopout} setShowAgentsPopout={setShowAgentsPopout}
          setLeftPopout={setLeftPopout}
          online={online} activeAgents={activeAgents} kvReadings={kvReadings}
          kvFetchFailed={kvFetchFailed} excludedBreaker={excludedBreaker}
          cacheStatus={cacheStatus} onClearCache={onClearCache}
          responses={responses} agentErrors={agentErrors} lastMeta={lastMeta}
        />

        <div className="brew-panel brew-panel--right">
          <div className="brew-panel-header">
            <span className="brew-panel-title">{deployed ? 'Session' : 'Live Preview'}</span>
          </div>

          {!deployed ? (
            <div className="brew-preview-inner">
              <div>
                <div className="brew-preview-section-title">Server Layout</div>
                <div className="brew-roster-label">Mode Roster</div>
                <div className="brew-roster-bar">
                  <div className="brew-roster-fill" style={{ width: `${brewConfig.rosterPct}%` }} />
                </div>
                <div className="brew-layout-table">
                  {brewConfig.serverLayout.length === 0 && (
                    <div style={{ fontSize: '0.68rem', color: 'var(--brew-text-dim)' }}>Select agents to see layout</div>
                  )}
                  {brewConfig.serverLayout.map(s => (
                    <div key={s.port} className="brew-layout-row">
                      <span className="brew-layout-port">:{s.port}</span>
                      <span className="brew-layout-para">
                        {s.engine === 'mlx' ? '[mlx]' : s.engine === 'vllm' ? '[vllm]' : `×${s.parallel}`}
                      </span>
                      <span className="brew-layout-model">{s.model?.split('/').pop() || '—'}</span>
                      <span className="brew-layout-agents">[{(s.agents || []).join(', ')}]</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="brew-code-preview" style={{ flex: '1 1 0' }}>
                <div className="brew-code-block">
                  {brewConfig.configLines.map((line, i) => (
                    <div key={i}><span className="brew-code-line-num">{i + 1}</span>{line}</div>
                  ))}
                </div>
              </div>
              <div className="brew-preview-roster">
                <ModeRosterPanel />
                <PresetsPanel />
              </div>
            </div>
          ) : (
            <div className="brew-chat-panel">
              <div className="brew-right-tabs">
                {RIGHT_TABS.map(([id, label]) => (
                  <button key={id} type="button"
                    className={`brew-right-tab${rightTab === id ? ' active' : ''}`}
                    onClick={() => setRightTab(id)}
                  >{label}</button>
                ))}
              </div>

              {rightTab === 'session' && (
                <BrewSessionTab
                  history={history} currentSession={currentSession} responses={responses}
                  finalAnswer={finalAnswer} loading={loading} error={error} pendingPrompt={pendingPrompt}
                  lastMeta={lastMeta} stageOutputs={stageOutputs} excludedBreaker={excludedBreaker}
                  selectedPrompt={selectedPrompt} selectedTemperature={selectedTemperature}
                  useRag={useRag} backend={backend} online={online} activeAgents={activeAgents}
                  activeMode={activeMode} onSubmit={onSubmit} onFollowUp={onFollowUp}
                  onClearSession={onClearSession} onSwitchSession={onSwitchSession}
                  onQualityPass={onQualityPass} onPromptConsumed={onPromptConsumed}
                  onSaveCode={onSaveCode} onUseRagChange={onUseRagChange}
                  switchBackend={switchBackend} onExpandProgrammer={onExpandProgrammer}
                />
              )}

              {rightTab === 'agents' && (
                <BrewAgentsTab
                  activeAgents={activeAgents} responses={responses} agentErrors={agentErrors}
                  loading={loading} lastMeta={lastMeta} activeMode={activeMode}
                  flatPickAgent={flatPickAgent} rolesByName={rolesByName}
                  onPickFlatAgent={onPickFlatAgent} onSaveCode={onSaveCode}
                  onSendBestContinue={onSendBestContinue}
                />
              )}

              {rightTab === 'modes' && (
                <div className="brew-modes-tab brew-modes-scroll">
                  <ModeRosterPanel />
                  <PresetsPanel />
                </div>
              )}

              {rightTab === 'brewcast' && (
                <BrewBroadcastTab
                  activeAgents={activeAgents} responses={responses} agentErrors={agentErrors}
                  loading={loading} lastMeta={lastMeta} stageOutputs={stageOutputs}
                  activeMode={activeMode} flatPickAgent={flatPickAgent} rolesByName={rolesByName}
                  onPickFlatAgent={onPickFlatAgent} onSaveCode={onSaveCode}
                />
              )}

              {rightTab === 'rag' && (
                <BrewRagTab
                  useRag={useRag} onUseRagChange={onUseRagChange} activeAgents={activeAgents}
                  loading={loading} online={online} lastMeta={lastMeta} onOpenRagAdmin={onOpenRagAdmin}
                />
              )}
            </div>
          )}
        </div>
      </div>

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
    </div>
  );
}
