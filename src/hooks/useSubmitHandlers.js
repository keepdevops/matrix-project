import { useCallback, useState } from 'react';
import { extractCodeBlock } from '../utils/codeExtractor';
import { qualityPassContextPolicy } from '../utils/qualityPassContext';

export function useSubmitHandlers({
  submit, loadHistory, currentSession, activeMode, useRag,
  responses, activeAgents, flatPickAgent,
  modeWarnings = [],
  onModeWarning,
}) {
  const [pendingPrompt, setPendingPrompt] = useState(null);

  const handleSubmit = useCallback(async (prompt, temperature, opts = {}) => {
    // Warn if the active mode has known deployment issues (non-blocking).
    if (modeWarnings.length > 0 && !opts.qualityPass && !opts.followup) {
      onModeWarning?.(modeWarnings);
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
  }, [submit, loadHistory, currentSession, activeMode, useRag, modeWarnings, onModeWarning]);

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
    const sections = [];
    activeAgents.forEach(({ name }) => {
      const resp = responses[name];
      if (!resp) return;
      const { code, language } = extractCodeBlock(resp);
      if (!code || code.trim().length < 10) return;
      sections.push(`// === ${name.toUpperCase()} (${language}) ===\n\n${code}`);
    });
    if (!sections.length) return;
    const separator = '\n\n// ────────────────────────────────────────────\n\n';
    const blob = new Blob([sections.join(separator)], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `swarm-matrix-${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return { pendingPrompt, handleSubmit, handleQualityPass, handleFollowUp, handleSendBestContinue, handleSaveCode };
}
