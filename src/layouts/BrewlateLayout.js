import React, { useState, useEffect, useCallback, useMemo } from 'react';
import './brewlate.css';
import './brewlate-themes.css';
import {
  fetchSwarmConfig,
  fetchModels,
  fetchAgents,
  invalidateModelsCache,
} from '../api/swarmApi';
import {
  ENGINES,
  PROFILE_CUSTOM,
  PROFILE_SAFE,
  PROFILE_BALANCED,
  PROFILE_MAX,
  PROFILE_MIXED,
  computeLayout,
  getProfileRoles,
  chooseModelForRole,
} from '../components/SwarmConfig.helpers';
import { computeRiskEstimate, RAM_WARN_GB } from '../components/SwarmConfig.risk';
import { useDeploy } from '../components/SwarmConfig.deploy';
import useRagHealth from '../hooks/useRagHealth';
import AgentPromptModal from '../components/AgentPromptModal';
import BrewResourcePopout from './BrewResourcePopout';
import BrewMonitorPopout from './BrewMonitorPopout';
import BrewAgentsPopout from './BrewAgentsPopout';
import BrewHeader from './BrewHeader';
import BrewAgentCard, { modelShortName } from './BrewAgentCard';
import BrewAgentGrid from './BrewAgentGrid';
import BrewCodeResultsPanel from './BrewCodeResultsPanel';
import BrewAgentPopout from './BrewAgentPopout';
import { extractCodeBlock } from '../utils/codeExtractor';
import CompareVariantsPanel from '../components/CompareVariantsPanel';
import RagSources from '../components/RagSources';
import RagControlsPanel from '../components/RagControlsPanel';
import MetricsStrip from '../components/MetricsStrip';
import PipelineStageOutputs from '../components/PipelineStageOutputs';
import ConversationThread from '../components/ConversationThread';
import FinalAnswerPanel from '../components/FinalAnswerPanel';
import PromptInput from '../components/PromptInput';
import ModeRosterPanel from '../components/ModeRosterPanel';
import PresetsPanel from '../components/PresetsPanel';
import HelpModal from '../components/HelpModal';
import RagAdmin from '../components/RagAdmin';
import CachePanel from '../components/CachePanel';
import ModelConverter from '../components/ModelConverter';

function parseContextFromRole(role) {
  return role.context || 0;
}

const VLLM_PRESTARTED = [
  { port: 8080, model: 'Qwen2.5-14B' },
  { port: 8081, model: 'Llama-3.2-3B' },
  { port: 8082, model: 'DeepSeek-Coder-V2' },
  { port: 8083, model: 'Phi-4-mini' },
];

const PROFILES = [
  [PROFILE_CUSTOM,   'Custom'],
  [PROFILE_SAFE,     'Safe'],
  [PROFILE_BALANCED, 'Balanced'],
  [PROFILE_MAX,      'Max'],
  [PROFILE_MIXED,    'Mixed'],
];

const RIGHT_TABS = [
  ['session',  'Session'],
  ['agents',   'Agents'],
  ['modes',    'Modes'],
  ['brewcast', 'Live'],
  ['rag',      'RAG'],
];

function buildConfigLines(layout, selected) {
  const lines = [];
  lines.push('swarm: {');
  lines.push(`  agents: ${selected.size},`);
  layout.slice(0, 6).forEach(s => {
    const agents = s.agents?.slice(0, 2).join(', ') || '—';
    lines.push(`  :${s.port} ×${s.parallel} [${agents}]`);
    if (s.model) lines.push(`    model: ${s.model.split('/').pop()}`);
  });
  lines.push('}');
  return lines;
}

function BrewRagTab({
  useRag, onUseRagChange, activeAgents, loading, online, lastMeta, onOpenRagAdmin,
}) {
  const ragHealth = useRagHealth(true);
  const [ragTopK, setRagTopK] = useState(() => {
    const raw = parseInt(typeof window !== 'undefined' && localStorage.getItem('rag.top_k'), 10);
    return Number.isFinite(raw) && raw >= 1 && raw <= 20 ? raw : 3;
  });
  const [ragMinScore, setRagMinScore] = useState(() => {
    const raw = parseFloat(typeof window !== 'undefined' && localStorage.getItem('rag.min_score'));
    return Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : 1.0;
  });
  const [selectedRagAgents, setSelectedRagAgents] = useState([]);

  return (
    <div className="brew-rag-panel">
      <RagControlsPanel
        useRag={useRag}
        onUseRagChange={onUseRagChange}
        ragHealth={ragHealth}
        ragTopK={ragTopK}
        setRagTopK={setRagTopK}
        ragMinScore={ragMinScore}
        setRagMinScore={setRagMinScore}
        selectedRagAgents={selectedRagAgents}
        setSelectedRagAgents={setSelectedRagAgents}
        activeAgents={activeAgents}
        loading={loading}
        disabled={!online}
      />
      <button type="button" className="brew-rag-admin-link" onClick={onOpenRagAdmin}>
        Manage RAG documents →
      </button>
      {lastMeta?.rag ? (
        <>
          <div className="brew-brewcast-section-title" style={{ marginTop: '0.75rem' }}>Last Retrieved Sources</div>
          <RagSources rag={lastMeta.rag} />
        </>
      ) : (
        <div className="brew-chat-empty" style={{ marginTop: '1rem' }}>
          <span className="brew-chat-empty-icon">🔍</span>
          <span>No RAG sources yet — run a prompt with RAG enabled</span>
        </div>
      )}
    </div>
  );
}

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
  const [roles, setRoles]               = useState([]);
  const [models, setModels]             = useState([]);
  const [selected, setSelected]         = useState(new Set());
  const [roleModels, setRoleModels]     = useState({});
  const [engine, setEngine]             = useState('llama');
  const [activeProfile, setActiveProfile] = useState(PROFILE_CUSTOM);
  const [profileThresholds, setProfileThresholds] = useState({});
  const [editingAgent, setEditingAgent] = useState(null);
  const [loadError, setLoadError]       = useState('');
  const [loadRetries, setLoadRetries]   = useState(0);
  const [deployed, setDeployed]         = useState(false);
  const [rightTab, setRightTab]         = useState('session');
  const [showMonitor, setShowMonitor]       = useState(false);
  const [showAgentsPopout, setShowAgentsPopout] = useState(false);
  const [leftPopout, setLeftPopout]         = useState(null);

  useEffect(() => {
    if (loading) {
      setRightTab('brewcast');
    } else if (lastMeta) {
      setRightTab('session');
    }
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

  useEffect(() => {
    let cancelled = false;
    setLoadError('');
    const activeAgentsPromise = fetchAgents().catch(e => {
      console.error('BrewlateLayout fetchAgents failed:', e);
      return [];
    });
    Promise.all([fetchSwarmConfig(), fetchModels(), activeAgentsPromise])
      .then(([config, modelList, liveAgents]) => {
        if (cancelled) return;
        setRoles(config.agents);
        if (config.coordinator?.profiles) setProfileThresholds(config.coordinator.profiles);
        setModels(modelList);
        setSelected(new Set(liveAgents.map(a => a.name)));
        const running = liveAgents[0];
        setEngine(running ? (running.engine || running.backend || 'llama') : 'llama');
        const preselected = {};
        liveAgents.forEach(a => { if (a.model) preselected[a.name] = a.model; });
        setRoleModels(preselected);
        // Auto-select SAFE when live host RAM is already above the warn threshold
        // so users don't accidentally configure an OOM roster on a pressured machine.
        const liveUsedGb = hostMemory?.ok && Number.isFinite(hostMemory.used_gb) ? hostMemory.used_gb : null;
        const defaultProfile = liveUsedGb !== null && liveUsedGb > RAM_WARN_GB
          ? PROFILE_SAFE
          : (liveAgents.length > 0 ? PROFILE_CUSTOM : PROFILE_SAFE);
        setActiveProfile(defaultProfile);
      })
      .catch(e => { if (!cancelled) setLoadError(e.message); });
    return () => { cancelled = true; };
  }, [loadRetries, hostMemory]);

  const engineModels = useMemo(
    () => models.filter(m => m.backend === engine),
    [models, engine],
  );

  const pickModelForRole = useCallback((roleName) => {
    const role = roles.find(r => r.name === roleName);
    const back = role?.engine || role?.backend || engine;
    const cands = models.filter(m => m.backend === back).length
      ? models.filter(m => m.backend === back)
      : engineModels;
    return chooseModelForRole(roleName, cands);
  }, [roles, models, engine, engineModels]);

  const handleEngineChange = id => {
    setEngine(id);
    setSelected(new Set());
    setRoleModels({});
    setActiveProfile(PROFILE_CUSTOM);
  };

  const toggleRole = name => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
        if (!roleModels[name]) {
          const path = pickModelForRole(name);
          if (path) setRoleModels(rm => ({ ...rm, [name]: path }));
        }
      }
      return next;
    });
    setActiveProfile(PROFILE_CUSTOM);
  };

  const setModel = (name, model) => {
    setRoleModels(prev => ({ ...prev, [name]: model }));
    setActiveProfile(PROFILE_CUSTOM);
  };

  const selectAllRoles = () => {
    const nextModels = { ...roleModels };
    const picked = new Set(roles.map(r => r.name));
    roles.forEach(r => {
      if (!nextModels[r.name]) {
        const path = pickModelForRole(r.name);
        if (path) nextModels[r.name] = path;
      }
    });
    setRoleModels(nextModels);
    setSelected(picked);
    setActiveProfile(PROFILE_CUSTOM);
  };

  const clearAllRoles = () => {
    setSelected(new Set());
    setActiveProfile(PROFILE_CUSTOM);
  };

  const applyProfile = profileId => {
    if (profileId === PROFILE_CUSTOM) {
      setActiveProfile(PROFILE_CUSTOM);
      return;
    }
    const roleMap    = new Map(roles.map(r => [r.name, r]));
    const ctxMap     = Object.fromEntries(roles.map(r => [r.name, r.context ?? 0]));
    const roleNames  = getProfileRoles(profileId, roles.map(r => r.name), ctxMap, profileThresholds);
    const picked     = roleNames.filter(n => roleMap.has(n));
    const nextModels = {};
    for (const rn of picked) {
      const role   = roleMap.get(rn);
      const back   = role?.engine || role?.backend || engine;
      const cands  = models.filter(m => m.backend === back).length
        ? models.filter(m => m.backend === back)
        : models.filter(m => m.backend === engine);
      const path   = chooseModelForRole(rn, cands);
      if (path) nextModels[rn] = path;
    }
    setSelected(new Set(picked));
    setRoleModels(nextModels);
    setActiveProfile(profileId);
    reset();
  };

  const riskEstimate = computeRiskEstimate(roles, selected, roleModels, models, hostMemory, activeMode);

  let serverLayout = computeLayout(roles, selected, roleModels, models);
  if (engine === 'vllm') {
    serverLayout = VLLM_PRESTARTED.map(({ port, model }) =>
      serverLayout.find(s => s.port === port) || { port, model, agents: [], parallel: 0, engine: 'vllm' }
    );
  }

  const canDeploy = selected.size > 0 && Array.from(selected).some(n => roleModels[n]);
  const agentCount = selected.size;
  const rosterPct  = Math.min(100, (agentCount / Math.max(roles.length, 1)) * 100);
  const configLines = buildConfigLines(serverLayout, selected);

  const recentHistory = useMemo(() => history.slice(-10).reverse(), [history]);
  const rolesByName = useMemo(
    () => Object.fromEntries(roles.map(r => [r.name, r])),
    [roles],
  );

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
        online={online}
        activeAgents={activeAgents}
        modes={modes}
        activeMode={activeMode}
        warningsByMode={warningsByMode}
        kvReadings={kvReadings}
        kvFetchFailed={kvFetchFailed}
        memoryPressure={memoryPressure}
        cacheStatus={cacheStatus}
        historyCount={history.length}
        deployed={deployed}
        theme={theme}
        layout={currentLayout}
        onModeChange={onModeChange}
        onClearCache={onClearCache}
        onToggleHistory={onToggleHistory}
        onOpenConverter={onOpenConverter}
        onOpenRagAdmin={onOpenRagAdmin}
        onOpenCachePanel={onOpenCachePanel}
        onOpenHelp={onOpenHelp}
        onSetTheme={onSetTheme}
        onSetLayout={onSetLayout}
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
        {/* Left: Configure */}
        <div className="brew-panel brew-panel--left">
          <div className="brew-panel-header">
            <span className="brew-panel-title">Configure</span>
            <div className="brew-panel-header-actions">
              {(canDeploy || online) && (
                <button
                  type="button"
                  className={`brew-monitor-trigger${showMonitor ? ' open' : ''}${online ? ' online' : ''}`}
                  onClick={() => setShowMonitor(v => !v)}
                  aria-expanded={showMonitor}
                  title="KV cache and port pressure"
                >
                  <span className={`brew-monitor-trigger-dot${online ? ' online' : ''}`} />
                  MONITOR
                </button>
              )}
              <span className="brew-panel-badge">
                {activeProfile} • {agentCount} Agent{agentCount !== 1 ? 's' : ''}
              </span>
            </div>
          </div>

          <BrewMonitorPopout
            open={showMonitor}
            onClose={() => setShowMonitor(false)}
            online={online}
            kvReadings={kvReadings}
            kvFetchFailed={kvFetchFailed}
            activeAgents={activeAgents}
            engine={engine}
            excludedBreaker={excludedBreaker}
            cacheStatus={cacheStatus}
            onClearCache={onClearCache}
          />

          <div className="brew-panel-scroll">
            <div className="brew-section">
              <div className="brew-section-header">
                <span className="brew-section-title">Engines</span>
              </div>
              <div className="brew-section-body">
                <div className="brew-engine-pills">
                  {ENGINES.map(e => {
                    const count = models.filter(m => m.backend === e.backend).length;
                    return (
                      <button
                        key={e.id}
                        type="button"
                        className={`brew-engine-pill${engine === e.id ? ' active' : ''}${count === 0 ? ' disabled' : ''}`}
                        onClick={() => count > 0 && handleEngineChange(e.id)}
                        title={`${count} model${count !== 1 ? 's' : ''} available`}
                      >
                        {e.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="brew-section">
              <div className="brew-section-header">
                <span className="brew-section-title">Profile</span>
              </div>
              <div className="brew-section-body">
                <div className="brew-profile-label">Preset</div>
                <div className="brew-profile-dropdowns">
                  <select
                    className="brew-profile-select"
                    value={activeProfile}
                    onChange={e => applyProfile(e.target.value)}
                  >
                    {PROFILES.map(([id, label]) => (
                      <option key={id} value={id}>{label}</option>
                    ))}
                  </select>
                </div>
                <p className="brew-profile-hint">
                  Presets fill the roster; use <strong>Custom</strong> and click agents to pick individually.
                </p>
              </div>
            </div>

            <div className="brew-section brew-section--agents" style={{ flex: '1 1 0', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <div className="brew-section-header brew-section-header--agents">
                <span className="brew-section-title">Agents</span>
                <div className="brew-agents-header-actions">
                  <button
                    type="button"
                    className="brew-agents-bulk-btn"
                    onClick={selectAllRoles}
                    title="Select every agent role"
                  >
                    All
                  </button>
                  <button
                    type="button"
                    className="brew-agents-bulk-btn"
                    onClick={clearAllRoles}
                    title="Clear agent selection"
                  >
                    None
                  </button>
                  <button
                    type="button"
                    className={`brew-agents-popout-trigger${showAgentsPopout ? ' open' : ''}`}
                    onClick={() => setShowAgentsPopout(v => !v)}
                    aria-expanded={showAgentsPopout}
                    title="Per-agent context and max token budgets"
                  >
                    BUDGETS
                  </button>
                </div>
              </div>

              <BrewAgentsPopout
                open={showAgentsPopout}
                onClose={() => setShowAgentsPopout(false)}
                roles={roles}
                selected={selected}
                onRolesChange={setRoles}
              />

              <div className="brew-section-body" style={{ flex: '1 1 0', overflowY: 'auto', padding: '0.75rem' }}>
                <div className="brew-agent-cards">
                  {roles.map(role => {
                    const isSelected   = selected.has(role.name);
                    const modelPath    = roleModels[role.name] || '';
                    const ctx          = parseContextFromRole(role);
                    const launchStatus = agentStatuses?.get(role.name);
                    const meta = launchStatus
                      ? launchStatus.toUpperCase()
                      : ctx > 0 ? `Context ${ctx.toLocaleString()}` : 'Context —';

                    const response   = responses?.[role.name] ?? null;
                    const agentError = agentErrors?.[role.name] ?? null;
                    const timing     = lastMeta?.timings?.[role.name] ?? null;
                    const hasResult  = !!(response || agentError);
                    const onExpand   = hasResult ? () => {
                      const { code, language } = response
                        ? extractCodeBlock(response)
                        : { code: null, language: null };
                      const hasCode = code && code.trim().length >= 10;
                      const resultMeta = timing
                        ? `${(timing.total_ms / 1000).toFixed(1)}s`
                        : agentError ? 'FAILED' : meta;
                      setLeftPopout({
                        name: role.name.toUpperCase(),
                        model: modelShortName(modelPath),
                        meta: resultMeta,
                        response,
                        error: agentError,
                        code: hasCode ? code : null,
                        language,
                      });
                    } : undefined;

                    return (
                      <BrewAgentCard
                        key={role.name}
                        name={role.name.toUpperCase()}
                        modelPath={modelPath}
                        meta={meta}
                        selected={isSelected}
                        hasResult={hasResult}
                        onClick={() => toggleRole(role.name)}
                        onEdit={() => setEditingAgent(role)}
                        onExpand={onExpand}
                        showCheckbox
                        checked={isSelected}
                        showModelSelect={engineModels.length > 0}
                        models={engineModels.length > 0 ? engineModels : models}
                        onModelChange={path => setModel(role.name, path)}
                      />
                    );
                  })}
                </div>
              </div>
            </div>

            {(canDeploy || online) && (
              <BrewResourcePopout
                riskEstimate={riskEstimate}
                roles={roles}
                selected={selected}
              />
            )}

            <div className="brew-left-footer">
              {statusMsg && <div className="brew-deploy-status">{statusMsg}</div>}
              <button
                type="button"
                className="brew-launch-btn"
                onClick={() => deploy({ roles, selected, roleModels, models, engine, riskEstimate, layout: serverLayout })}
                disabled={!canDeploy || status === 'deploying'}
              >
                {status === 'deploying' ? 'Brewing…' : 'Brew'}
              </button>
            </div>
          </div>
        </div>

        {/* Right: Preview or runtime */}
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
                  <div className="brew-roster-fill" style={{ width: `${rosterPct}%` }} />
                </div>
                <div className="brew-layout-table">
                  {serverLayout.length === 0 && (
                    <div style={{ fontSize: '0.68rem', color: 'var(--brew-text-dim)' }}>Select agents to see layout</div>
                  )}
                  {serverLayout.map(s => (
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
                  {configLines.map((line, i) => (
                    <div key={i}>
                      <span className="brew-code-line-num">{i + 1}</span>
                      {line}
                    </div>
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
                  <button
                    key={id}
                    type="button"
                    className={`brew-right-tab${rightTab === id ? ' active' : ''}`}
                    onClick={() => setRightTab(id)}
                  >{label}</button>
                ))}
              </div>

              {rightTab === 'session' && (
                <div className="brew-session-tab">
                  <div className="brew-session-scroll">
                    {excludedBreaker.length > 0 && (
                      <div className="dispatch-hint-banner dispatch-hint-banner--breaker brew-breaker-banner" role="status">
                        Skipped (circuit breaker open):{' '}
                        <strong>{excludedBreaker.join(', ')}</strong>. Cooldown ~30s.
                      </div>
                    )}
                    {error && (
                      <div className="error-banner brew-error-banner">
                        {error.includes('Coordinator offline')
                          ? 'Swarm not running — open CONFIGURE and click Brew.'
                          : `ERROR: ${error}`}
                      </div>
                    )}
                    <ConversationThread
                      history={history}
                      sessionId={currentSession?.sessionId}
                      responses={responses}
                      finalAnswer={finalAnswer}
                      loading={loading}
                      pendingPrompt={pendingPrompt}
                      onFollowUp={onFollowUp}
                      onClear={onClearSession}
                      onSwitchSession={onSwitchSession}
                    />
                    <FinalAnswerPanel text={finalAnswer} />
                    <BrewCodeResultsPanel
                      responses={responses}
                      activeAgents={activeAgents}
                      loading={loading}
                      onSaveCode={onSaveCode}
                      onExpandProgrammer={onExpandProgrammer}
                    />
                    <RagSources rag={lastMeta?.rag} />
                    {lastMeta && (
                      <>
                        <PipelineStageOutputs stageOutputs={stageOutputs} />
                        <MetricsStrip envelope={{ meta: lastMeta }} />
                      </>
                    )}
                  </div>
                  <div className="brew-session-prompt">
                    <PromptInput
                      onSubmit={onSubmit}
                      loading={loading}
                      disabled={!online}
                      externalPrompt={selectedPrompt}
                      externalTemperature={selectedTemperature}
                      onPromptConsumed={onPromptConsumed}
                      canContinue={Boolean(currentSession?.sessionId)}
                      onQualityPass={onQualityPass}
                      useRag={useRag}
                      onUseRagChange={onUseRagChange}
                      activeAgents={activeAgents}
                      backend={backend}
                      onBackendChange={switchBackend}
                      activeMode={activeMode}
                      submitLabel="BREW"
                      submitLoadingLabel="BREWING…"
                      qualityPassLabel="REFINE"
                    />
                  </div>
                </div>
              )}

              {rightTab === 'agents' && (
                <div className="brew-agents-tab">
                  <BrewAgentGrid
                    activeAgents={activeAgents}
                    responses={responses}
                    agentErrors={agentErrors}
                    loading={loading}
                    timings={lastMeta?.timings || {}}
                    flatPickMode={activeMode === 'flat'}
                    pickedFlatAgent={flatPickAgent}
                    onPickFlatAgent={onPickFlatAgent}
                    onSaveCode={onSaveCode}
                    rolesByName={rolesByName}
                  />
                  {activeMode === 'flat' && Object.keys(responses).length > 0 && (
                    <CompareVariantsPanel
                      activeAgents={activeAgents}
                      responses={responses}
                      loading={loading}
                      flatPickAgent={flatPickAgent}
                      onPickAgent={onPickFlatAgent}
                      onSendBest={() => onSendBestContinue(0.2)}
                    />
                  )}
                </div>
              )}

              {rightTab === 'modes' && (
                <div className="brew-modes-tab brew-modes-scroll">
                  <ModeRosterPanel />
                  <PresetsPanel />
                </div>
              )}

              {rightTab === 'brewcast' && (
                <div className="brew-brewcast-panel">
                  {!lastMeta && !loading && (
                    <div className="brew-chat-empty">
                      <span className="brew-chat-empty-icon">📡</span>
                      <span>No broadcast yet — run a prompt first</span>
                    </div>
                  )}
                  {loading && (
                    <div className="brew-brewcast-live">
                      <span className="brew-brewcast-dot" />
                      <span className="brew-brewcast-live-label">LIVE</span>
                    </div>
                  )}
                  {(loading || lastMeta) && (
                    <div className="brew-brewcast-agents">
                      <BrewAgentGrid
                        activeAgents={activeAgents}
                        responses={responses}
                        agentErrors={agentErrors}
                        loading={loading}
                        timings={lastMeta?.timings || {}}
                        flatPickMode={activeMode === 'flat'}
                        pickedFlatAgent={flatPickAgent}
                        onPickFlatAgent={onPickFlatAgent}
                        onSaveCode={onSaveCode}
                        rolesByName={rolesByName}
                        compact
                      />
                    </div>
                  )}
                  {lastMeta && (
                    <>
                      <div className="brew-brewcast-section-title">Pipeline Stages</div>
                      <PipelineStageOutputs stageOutputs={stageOutputs} />
                      <div className="brew-brewcast-section-title" style={{ marginTop: '0.75rem' }}>Agent Timings</div>
                      <MetricsStrip envelope={{ meta: lastMeta }} />
                    </>
                  )}
                </div>
              )}

              {rightTab === 'rag' && (
                <BrewRagTab
                  useRag={useRag}
                  onUseRagChange={onUseRagChange}
                  activeAgents={activeAgents}
                  loading={loading}
                  online={online}
                  lastMeta={lastMeta}
                  onOpenRagAdmin={onOpenRagAdmin}
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
            <div className="brew-converter">
              <ModelConverter standalone />
            </div>
          </div>
        </div>
      )}

      {showHelp && <HelpModal onClose={onCloseHelp} agents={activeAgents} />}
      {showRagAdmin && <RagAdmin onClose={onCloseRagAdmin} />}
      {showCachePanel && <CachePanel onClose={onCloseCachePanel} />}
      {leftPopout && (
        <BrewAgentPopout
          name={leftPopout.name}
          model={leftPopout.model}
          meta={leftPopout.meta}
          response={leftPopout.response}
          error={leftPopout.error}
          code={leftPopout.code}
          language={leftPopout.language}
          onClose={() => setLeftPopout(null)}
        />
      )}
    </div>
  );
}
