import React, { useState } from 'react';
import AppHeader from '../components/AppHeader';
import RagAdmin from '../components/RagAdmin';
import HelpModal from '../components/HelpModal';
import CachePanel from '../components/CachePanel';
import SidebarLayoutSidebar from './SidebarLayoutSidebar';
import SidebarLayoutMain from './SidebarLayoutMain';
import './SidebarLayout.css';

export default function SidebarLayout({
  online, activeAgents, modes, activeMode, kvReadings, kvFetchFailed,
  responses, finalAnswer, loading, error, history, lastMeta,
  currentSession, backend, switchBackend,
  showConfig, showHistory, showConfigPanel, deployPending,
  showHelp, showConverter, showRagAdmin, showCachePanel,
  cacheStatus, useRag, pendingPrompt,
  flatPickAgent, excludedBreaker, stageOutputs, warningsByMode, memoryPressure,
  theme, layout, onSetTheme, onSetLayout,
  onModeChange, onClearCache,
  onToggleConfig, onToggleHistory,
  onOpenConverter, onOpenRagAdmin, onOpenCachePanel, onOpenHelp,
  onDeployed, onHistorySelect,
  onSubmit, onQualityPass, onPromptConsumed,
  onFollowUp, onClearSession, onSwitchSession,
  onSaveCode, onPickFlatAgent, onSendBestContinue,
  onUseRagChange, selectedPrompt, selectedTemperature,
}) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div className="sl-root">
      <AppHeader
        online={online} activeAgents={activeAgents} modes={modes} activeMode={activeMode}
        kvReadings={kvReadings} kvFetchFailed={kvFetchFailed} cacheStatus={cacheStatus}
        showConfigPanel={showConfigPanel} theme={theme} layout={layout}
        historyCount={history.length} onModeChange={onModeChange} onClearCache={onClearCache}
        onToggleConfig={onToggleConfig} onToggleHistory={onToggleHistory}
        onOpenConverter={onOpenConverter} onOpenRagAdmin={onOpenRagAdmin}
        onOpenCachePanel={onOpenCachePanel} onOpenHelp={onOpenHelp}
        onSetTheme={onSetTheme} onSetLayout={onSetLayout}
        warningsByMode={warningsByMode} memoryPressure={memoryPressure}
      />

      <div className={`sl-body${sidebarCollapsed ? ' sl-body--collapsed' : ''}`}>
        <SidebarLayoutSidebar
          collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(v => !v)}
          online={online} kvReadings={kvReadings} kvFetchFailed={kvFetchFailed}
          showConverter={showConverter} showConfigPanel={showConfigPanel} onDeployed={onDeployed}
          showHistory={showHistory} history={history} onHistorySelect={onHistorySelect}
          lastMeta={lastMeta}
        />

        <SidebarLayoutMain
          excludedBreaker={excludedBreaker} error={error} online={online}
          loading={loading} activeMode={activeMode} activeAgents={activeAgents}
          responses={responses} finalAnswer={finalAnswer} pendingPrompt={pendingPrompt}
          history={history} currentSession={currentSession} stageOutputs={stageOutputs}
          lastMeta={lastMeta} backend={backend} switchBackend={switchBackend}
          flatPickAgent={flatPickAgent} useRag={useRag}
          selectedPrompt={selectedPrompt} selectedTemperature={selectedTemperature}
          onSubmit={onSubmit} onQualityPass={onQualityPass} onPromptConsumed={onPromptConsumed}
          onFollowUp={onFollowUp} onClearSession={onClearSession} onSwitchSession={onSwitchSession}
          onSaveCode={onSaveCode} onPickFlatAgent={onPickFlatAgent}
          onSendBestContinue={onSendBestContinue} onUseRagChange={onUseRagChange}
        />
      </div>

      {showHelp      && <HelpModal  onClose={onOpenHelp} />}
      {showRagAdmin  && <RagAdmin   onClose={onOpenRagAdmin} />}
      {showCachePanel && <CachePanel onClose={onOpenCachePanel} />}
    </div>
  );
}
