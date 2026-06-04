import { buildCodeExport, downloadBlob } from '../utils/codeSave';

export function buildQualityPassInstruction() {
  return [
    'Review the previous output for compile errors, duplicate files/functions,',
    'missing implementation, unsafe numeric types, and mismatch with the original prompt.',
    'Produce a corrected final answer.',
  ].join(' ');
}

export function buildSendBestContinueOpts(flatPickAgent) {
  return {
    followup: true,
    contextPolicy: {
      include: ['original_prompt', 'final', flatPickAgent],
      target_agent: flatPickAgent,
      // Sized for --ctx-size 2048 on M3 Max; was 30000 (exceeded server window)
      max_context_chars: 4500,
    },
  };
}

export function execSaveCode(activeAgents, responses, onSaveCodeToast) {
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
}
