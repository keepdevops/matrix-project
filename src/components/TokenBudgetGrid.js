import React from 'react';
import TokenBudgetRow from './TokenBudgetRow';

export const MIN_MAX_TOKENS = 64;
export const MAX_MAX_TOKENS = 131072;
export const MIN_CONTEXT = 512;
export const MAX_CONTEXT = 262144;
export const MIN_TIMEOUT = 30;
export const MAX_TIMEOUT = 7200;
export const MIN_GPU_LAYERS = 0;
export const MAX_GPU_LAYERS = 999;
export const MIN_CONCURRENCY = 1;
export const MAX_CONCURRENCY = 64;
export const MIN_MAX_INPUT_TOKENS = 256;
export const MAX_MAX_INPUT_TOKENS = 131072;
export const MIN_MAX_OUTPUT_TOKENS = 64;
export const MAX_MAX_OUTPUT_TOKENS = 131072;

export default function TokenBudgetGrid({ visibleRoles, drafts, errors, notices, busy, isDirty, setDraft, saveOne }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1fr 4.5rem 4.5rem 3.75rem 3.25rem 3.25rem 3.25rem 3.25rem 4.5rem',
      columnGap: '0.4rem',
      rowGap: '0.15rem',
      fontSize: '0.78rem',
      alignItems: 'center',
      lineHeight: 1.2,
    }}>
      <div style={{ opacity: 0.55, fontSize: '0.72rem' }}>agent</div>
      <div style={{ opacity: 0.55, fontSize: '0.72rem' }}>ctx</div>
      <div style={{ opacity: 0.55, fontSize: '0.72rem' }}>max_tok</div>
      <div style={{ opacity: 0.55, fontSize: '0.72rem' }} title="HTTP read timeout (seconds). Auto-bumped when max_tokens is raised past 4096.">to (s)</div>
      <div style={{ opacity: 0.55, fontSize: '0.72rem' }} title="GPU layers offloaded. Takes effect on next deploy.">gpu</div>
      <div style={{ opacity: 0.55, fontSize: '0.72rem' }} title="Max concurrent requests for this agent.">conc</div>
      <div style={{ opacity: 0.55, fontSize: '0.72rem' }} title="Hard input token cap per request (0 = no cap).">max_in</div>
      <div style={{ opacity: 0.55, fontSize: '0.72rem' }} title="Generation length cap (0 = use max_tokens).">max_out</div>
      <div />
      {visibleRoles.map(role => (
        <TokenBudgetRow key={role.name} role={role} drafts={drafts} errors={errors}
          notices={notices} busy={busy} isDirty={isDirty} setDraft={setDraft} saveOne={saveOne} />
      ))}
    </div>
  );
}
