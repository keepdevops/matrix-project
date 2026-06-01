import { useCallback, useState } from 'react';
import { splitIntoChunks } from '../api/orchestrateApi';
import { getModeManifestEntry } from '../utils/modeManifest';
import { buildQualityPassInstruction, buildSendBestContinueOpts, execSaveCode } from './useSubmitHandlers.helpers';
export { buildCodeExport } from '../utils/codeSave'; // re-export for static audits
import { qualityPassContextPolicy } from '../utils/qualityPassContext';

const PYTHON_ORCHESTRATE_MODES = new Set(['map_reduce', 'speculative', 'critic_debate', 'tree_of_thought']);

export function useSubmitHandlers({
  submit, loadHistory, currentSession, activeMode, useRag,
  responses, activeAgents, flatPickAgent,
  modeWarnings = [], memoryPressure = null, hostMemory = null,
  onModeWarning, onSaveCodeToast, onMemoryPressureWarning,
}) {
  const [pendingPrompt, setPendingPrompt] = useState(null);

  const handleSubmit = useCallback(async (prompt, temperature, opts = {}) => {
    if (PYTHON_ORCHESTRATE_MODES.has(activeMode) && !opts.followup && !opts.qualityPass) {
      let orchestrateParams = opts.modeParams || {};
      if (activeMode === 'map_reduce') {
        orchestrateParams = { chunks: splitIntoChunks(prompt, opts.chunkCount || 3) };
      }
      const entry = getModeManifestEntry(activeMode);
      const freeGb = hostMemory?.ok && Number.isFinite(hostMemory.free_gb) ? hostMemory.free_gb : null;
      if (freeGb !== null && freeGb < (entry?.memoryWeight ?? 2) * 4) {
        onMemoryPressureWarning?.({
          warnings: [`${activeMode}: only ${freeGb.toFixed(1)} GB free — elevated pressure during multi-agent run`],
        });
      }
      setPendingPrompt(prompt);
      try {
        await submit(prompt, temperature, { orchestrateMode: activeMode, orchestrateParams, useRag, ragTopK: opts.ragTopK, ragMinScore: opts.ragMinScore });
        loadHistory();
      } catch (err) {
        console.error(`[useSubmitHandlers] ${activeMode} failed:`, err);
      } finally {
        setPendingPrompt(null);
      }
      return;
    }

    if (modeWarnings.length > 0 && !opts.qualityPass && !opts.followup) onModeWarning?.(modeWarnings);
    if (memoryPressure?.shouldWarnOnSubmit && !opts.qualityPass && !opts.followup && !opts.skipMemoryWarn) {
      onMemoryPressureWarning?.(memoryPressure);
    }

    setPendingPrompt(prompt);
    try {
      const autoOpts = { ...opts };
      if (currentSession?.sessionId && !opts.followup && !opts.qualityPass) {
        const hasFinal = ['pipeline', 'cascade'].includes(activeMode);
        autoOpts.followup = true;
        autoOpts.contextPolicy = autoOpts.contextPolicy || {
          include: hasFinal ? ['original_prompt', 'final'] : ['original_prompt'],
          max_context_chars: 20000,
        };
      }
      const result = await submit(prompt, temperature, { useRag, ...autoOpts });
      if (activeMode === 'cascade' && result?.final === null && !opts.followup) {
        onModeWarning?.(['cascade ran without synthesis — synthesizer may not be deployed']);
      }
      loadHistory();
    } catch (err) {
      console.error('Submission failed:', err);
    } finally {
      setPendingPrompt(null);
    }
  }, [submit, loadHistory, currentSession, activeMode, useRag, modeWarnings, memoryPressure, onModeWarning, onMemoryPressureWarning]);

  const handleQualityPass = useCallback(async (temperature = 0.2) => {
    await handleSubmit(buildQualityPassInstruction(), temperature, {
      followup: true, qualityPass: true,
      contextPolicy: qualityPassContextPolicy(activeMode || 'pipeline'),
    });
  }, [handleSubmit, activeMode]);

  const handleFollowUp = useCallback(async (text, contextPolicy) => {
    await handleSubmit(text, 0.5, { followup: true, contextPolicy });
    loadHistory();
  }, [handleSubmit, loadHistory]);

  const handleSendBestContinue = async (temperature = 0.2) => {
    if (!flatPickAgent || !responses[flatPickAgent]) return;
    await handleSubmit(
      'Refine and finalize the selected variant. Address gaps, risks, and production readiness.',
      temperature,
      buildSendBestContinueOpts(flatPickAgent),
    );
  };

  const handleSaveCode = () => execSaveCode(activeAgents, responses, onSaveCodeToast);

  return { pendingPrompt, handleSubmit, handleQualityPass, handleFollowUp, handleSendBestContinue, handleSaveCode };
}
