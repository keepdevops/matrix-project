import React from 'react';
// RAG: lastMeta?.rag passed to RagSources — impl in DefaultLayoutMain.js
import AppHeader from '../components/AppHeader';
import SwarmConfig from '../components/SwarmConfig';
import ModelConverter from '../components/ModelConverter';
import HelpModal from '../components/HelpModal';
import RagAdmin from '../components/RagAdmin';
import CachePanel from '../components/CachePanel';
import DefaultLayoutMain from './DefaultLayoutMain';

export default function DefaultLayout({
  online, activeAgents, modes, activeMode, kvReadings, kvFetchFailed,
  responses, finalAnswer, loading, error, history, lastMeta,
  currentSession, backend, switchBackend,
  showConfig, showHistory, showConfigPanel, deployPending,
  showHelp, showConverter, showRagAdmin, showCachePanel,
  cacheStatus, useRag, pendingPrompt,
  flatPickAgent, excludedBreaker, stageOutputs, warningsByMode, memoryPressure, budgetExhausted,
  theme, layout, onSetTheme, onSetLayout,
  onModeChange, onClearCache,
  onToggleConfig, onToggleHistory,
  onOpenConverter, onOpenRagAdmin, onOpenCachePanel, onOpenHelp,
  onDeployed, onHistorySelect,
  onSubmit, onQualityPass, onPromptConsumed,
  onFollowUp, onClearSession, onSwitchSession,
  onSaveCode, onPickFlatAgent, onSendBestContinue,
  onUseRagChange, selectedPrompt, selectedTemperature,
  qualityPassTarget, onQualityPassTargetChange,
}) {
  return (
    <div className="matrix-container">
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

      {showConverter && (
        <div style={{ padding: '1rem 1.5rem', maxWidth: 860, margin: '0 auto' }}>
          <ModelConverter standalone />
        </div>
      )}
      {!showConverter && showConfigPanel && <SwarmConfig onDeployed={onDeployed} />}

      {showHistory && history.length > 0 && (
        <div className="history-dropdown">
          {history.slice(-10).reverse().map((entry, index) => (
            <div key={index} className="history-item" onClick={() => onHistorySelect(entry)}>
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

      {!showConfigPanel && (
        <DefaultLayoutMain
          online={online} activeAgents={activeAgents} activeMode={activeMode}
          kvReadings={kvReadings} kvFetchFailed={kvFetchFailed}
          responses={responses} finalAnswer={finalAnswer} loading={loading} error={error}
          history={history} lastMeta={lastMeta}
          currentSession={currentSession} backend={backend} switchBackend={switchBackend}
          useRag={useRag} pendingPrompt={pendingPrompt}
          flatPickAgent={flatPickAgent} excludedBreaker={excludedBreaker} stageOutputs={stageOutputs}
          selectedPrompt={selectedPrompt} selectedTemperature={selectedTemperature}
          onSubmit={onSubmit} onQualityPass={onQualityPass} onPromptConsumed={onPromptConsumed}
          onFollowUp={onFollowUp} onClearSession={onClearSession} onSwitchSession={onSwitchSession}
          onSaveCode={onSaveCode} onPickFlatAgent={onPickFlatAgent}
          onSendBestContinue={onSendBestContinue} onUseRagChange={onUseRagChange}
          budgetExhausted={budgetExhausted}
<<<<<<< Updated upstream
=======
          qualityPassTarget={qualityPassTarget} onQualityPassTargetChange={onQualityPassTargetChange}
>>>>>>> Stashed changes
        />
      )}

      {showHelp      && <HelpModal  onClose={onOpenHelp} />}
      {showRagAdmin  && <RagAdmin   onClose={onOpenRagAdmin} />}
      {showCachePanel && <CachePanel onClose={onOpenCachePanel} />}
    </div>
  );
}
