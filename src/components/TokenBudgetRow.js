import React from 'react';
import Button from './Button';
import {
  MIN_CONTEXT, MAX_CONTEXT, MIN_MAX_TOKENS, MAX_MAX_TOKENS,
  MIN_TIMEOUT, MAX_TIMEOUT, MIN_GPU_LAYERS, MAX_GPU_LAYERS,
  MIN_CONCURRENCY, MAX_CONCURRENCY,
  MIN_MAX_INPUT_TOKENS, MAX_MAX_INPUT_TOKENS,
  MIN_MAX_OUTPUT_TOKENS, MAX_MAX_OUTPUT_TOKENS,
} from './TokenBudgetGrid';

export default function TokenBudgetRow({ role, drafts, errors, notices, busy, isDirty, setDraft, saveOne }) {
  const dirty = isDirty(role);
  const err = errors[role.name];
  const note = notices[role.name];
  const isBusy = !!busy[role.name];
  const ctxVal = drafts[role.name]?.context ?? role.context ?? '';
  const mtVal = drafts[role.name]?.max_tokens ?? role.max_tokens ?? '';
  const toVal = drafts[role.name]?.read_timeout_secs ?? role.read_timeout_secs ?? '';
  const gpuVal = drafts[role.name]?.gpu_layers ?? role.gpu_layers ?? '';
  const concVal = drafts[role.name]?.max_concurrency ?? role.max_concurrency ?? '';
  const mitVal = drafts[role.name]?.max_input_tokens ?? role.max_input_tokens ?? '';
  const motVal = drafts[role.name]?.max_output_tokens ?? role.max_output_tokens ?? '';
  const inputStyle = { padding: '0.05rem 0.25rem', fontSize: '0.78rem', width: '100%', lineHeight: 1.2 };
  const tooltip = err
    ? `${role.name} :${role.port} — ${err}`
    : note ? `${role.name} :${role.port} — ${note}` : `port :${role.port}`;

  return (
    <React.Fragment key={role.name}>
      <div title={tooltip} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: err ? '#ff8888' : (note ? '#9ec99e' : undefined) }}>
        {role.name}
        {err && <span style={{ marginLeft: '0.25rem' }}>⚠</span>}
        {!err && note && <span style={{ marginLeft: '0.25rem' }}>✓</span>}
      </div>
      <input type="number" min={MIN_CONTEXT} max={MAX_CONTEXT} step={512} value={ctxVal}
        onChange={e => setDraft(role.name, 'context', e.target.value)} disabled={isBusy} style={inputStyle} />
      <input type="number" min={MIN_MAX_TOKENS} max={MAX_MAX_TOKENS} step={64} value={mtVal}
        onChange={e => setDraft(role.name, 'max_tokens', e.target.value)} disabled={isBusy} style={inputStyle} />
      <input type="number" min={MIN_TIMEOUT} max={MAX_TIMEOUT} step={30} value={toVal}
        onChange={e => setDraft(role.name, 'read_timeout_secs', e.target.value)} disabled={isBusy} style={inputStyle}
        title="HTTP read timeout (s). Leave blank to let the server auto-pick when raising max_tokens." />
      <input type="number" min={MIN_GPU_LAYERS} max={MAX_GPU_LAYERS} step={1} value={gpuVal}
        onChange={e => setDraft(role.name, 'gpu_layers', e.target.value)} disabled={isBusy} style={inputStyle}
        title="GPU layers offloaded to VRAM. Takes effect on next deploy." />
      <input type="number" min={MIN_CONCURRENCY} max={MAX_CONCURRENCY} step={1} value={concVal}
        onChange={e => setDraft(role.name, 'max_concurrency', e.target.value)}
        disabled={isBusy || role.max_concurrency === undefined} style={inputStyle}
        title={role.max_concurrency === undefined ? 'Not configurable for this agent' : 'Max concurrent requests'}
        placeholder={role.max_concurrency === undefined ? '—' : ''} />
      <input type="number" min={MIN_MAX_INPUT_TOKENS} max={MAX_MAX_INPUT_TOKENS} step={256} value={mitVal}
        onChange={e => setDraft(role.name, 'max_input_tokens', e.target.value)} disabled={isBusy} style={inputStyle}
        title="Max input tokens per request (0 = no cap). Truncates prompt before dispatch."
        placeholder="0" />
      <input type="number" min={MIN_MAX_OUTPUT_TOKENS} max={MAX_MAX_OUTPUT_TOKENS} step={64} value={motVal}
        onChange={e => setDraft(role.name, 'max_output_tokens', e.target.value)} disabled={isBusy} style={inputStyle}
        title="Generation length cap sent as num_predict to llama (0 = use max_tokens)."
        placeholder="0" />
      <Button variant="ghost" size="xs" onClick={() => saveOne(role)} disabled={!dirty || isBusy}
        title={err || note || (dirty ? 'Save changes' : 'No changes')}
        style={err ? { borderColor: 'var(--color-error)' } : note ? { borderColor: 'var(--color-primary)' } : undefined}>
        {isBusy ? '…' : 'Save'}
      </Button>
    </React.Fragment>
  );
}
