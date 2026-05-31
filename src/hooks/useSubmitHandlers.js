import { useCallback, useState } from 'react';
import { buildCodeExport, downloadBlob } from '../utils/codeSave';
import { qualityPassContextPolicy } from '../utils/qualityPassContext';
import { splitIntoChunks } from '../api/orchestrateApi';
import { getModeManifestEntry } from '../utils/modeManifest';

const PYTHON_ORCHESTRATE_MODES = new Set(['map_reduce', 'speculative', 'critic_debate']);

export function useSubmitHandlers({
  submit, loadHistory, currentSession, activeMode, useRag,
  responses, activeAgents, flatPickAgent,
  modeWarnings = [],
  memoryPressure = null,
  hostMemory = null,
  onModeWarning,
  onSaveCodeToast,
  onMemoryPressureWarning,
}) {
  const [pendingPrompt, setPendingPrompt] = useState(null);

  const handleSubmit = useCallback(async (prompt, temperature, opts = {}) => {
    // Python orchestrate modes bypass the streaming path entirely.
    if (PYTHON_ORCHESTRATE_MODES.has(activeMode) && !opts.followup && !opts.qualityPass) {
      let orchestrateParams = opts.modeParams || {};
      if (activeMode === 'map_reduce') {
        orchestrateParams = { chunks: splitIntoChunks(prompt, opts.chunkCount || 3) };
      }
      // Context budget guard: warn (non-blocking) when free RAM is tight for this mode's weight.
      const entry = getModeManifestEntry(activeMode);
      const freeGb = hostMemory?.ok && Number.isFinite(hostMemory.free_gb) ? hostMemory.free_gb : null;
      if (freeGb !== null && freeGb < (entry?.memoryWeight ?? 2) * 4) {
        onMemoryPressureWarning?.({
          warnings: [`${activeMode}: only ${freeGb.toFixed(1)} GB free — elevated pressure during multi-agent run`],
        });
      }
      setPendingPrompt(prompt);
      try {
        await submit(prompt, temperature, { orchestrateMode: activeMode, orchestrateParams });
        loadHistory();
      } catch (err) {
        console.error(`[useSubmitHandlers] ${activeMode} failed:`, err);
      } finally {
        setPendingPrompt(null);
      }
      return;
    }

    // Warn if the active mode has known deployment issues (non-blocking).
    if (modeWarnings.length > 0 && !opts.qualityPass && !opts.followup) {
      onModeWarning?.(modeWarnings);
    }

    if (
      memoryPressure?.shouldWarnOnSubmit
      && !opts.qualityPass
      && !opts.followup
      && !opts.skipMemoryWarn
    ) {
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
      // Post-broadcast: cascade ran but produced no final answer → synthesizer was absent.
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
    const instruction = [
      'Review the previous output for compile errors, duplicate files/functions,',
      'missing implementation, unsafe numeric types, and mismatch with the original prompt.',
      'Produce a corrected final answer.',
    ].join(' ');
    await handleSubmit(instruction, temperature, {
      followup: true,
      qualityPass: true,
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
      {
        followup: true,
        contextPolicy: {
          include: ['original_prompt', 'final', flatPickAgent],
          target_agent: flatPickAgent,
          max_context_chars: 30000,
        },
      },
    );
  };

  const handleSaveCode = () => {
    const result = buildCodeExport(activeAgents, responses);
    if (!result.ok) {
      onSaveCodeToast?.(result.message || 'Nothing to save', 'warn');
      return;
    }
    downloadBlob(result.blob, result.filename);
    const msg = result.format === 'zip'
      ? `Saved ${result.fileCount} files (${result.filename})`
      : `Saved ${result.filename}`;
    onSaveCodeToast?.(msg, 'success');
  };

  return { pendingPrompt, handleSubmit, handleQualityPass, handleFollowUp, handleSendBestContinue, handleSaveCode };
}
