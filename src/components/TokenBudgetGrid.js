import React from 'react';

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

export default function TokenBudgetGrid({ visibleRoles, drafts, errors, notices, busy, isDirty, setDraft, saveOne }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1fr 4.5rem 4.5rem 3.75rem 3.25rem 3.25rem 3.25rem',
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
      <div />
      {visibleRoles.map(role => {
        const dirty = isDirty(role);
        const err = errors[role.name];
        const note = notices[role.name];
        const isBusy = !!busy[role.name];
        const ctxVal = drafts[role.name]?.context ?? role.context ?? '';
        const mtVal = drafts[role.name]?.max_tokens ?? role.max_tokens ?? '';
        const toVal = drafts[role.name]?.read_timeout_secs ?? role.read_timeout_secs ?? '';
        const gpuVal = drafts[role.name]?.gpu_layers ?? role.gpu_layers ?? '';
        const concVal = drafts[role.name]?.max_concurrency ?? role.max_concurrency ?? '';
        const inputStyle = { padding: '0.05rem 0.25rem', fontSize: '0.78rem', width: '100%', lineHeight: 1.2 };
        const saveStyle = {
          padding: '0.05rem 0.3rem',
          fontSize: '0.72rem',
          border: err ? '1px solid #ff5555' : undefined,
          background: !err && note ? '#1a3a1a' : undefined,
          color: !err && note ? '#9ec99e' : undefined,
        };
        const tooltip = err
          ? `${role.name} :${role.port} — ${err}`
          : note
            ? `${role.name} :${role.port} — ${note}`
            : `port :${role.port}`;
        return (
          <React.Fragment key={role.name}>
            <div
              title={tooltip}
              style={{
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                color: err ? '#ff8888' : (note ? '#9ec99e' : undefined),
              }}
            >
              {role.name}
              {err && <span style={{ marginLeft: '0.25rem' }}>⚠</span>}
              {!err && note && <span style={{ marginLeft: '0.25rem' }}>✓</span>}
            </div>
            <input
              type="number" min={MIN_CONTEXT} max={MAX_CONTEXT} step={512}
              value={ctxVal}
              onChange={e => setDraft(role.name, 'context', e.target.value)}
              disabled={isBusy} style={inputStyle}
            />
            <input
              type="number" min={MIN_MAX_TOKENS} max={MAX_MAX_TOKENS} step={64}
              value={mtVal}
              onChange={e => setDraft(role.name, 'max_tokens', e.target.value)}
              disabled={isBusy} style={inputStyle}
            />
            <input
              type="number" min={MIN_TIMEOUT} max={MAX_TIMEOUT} step={30}
              value={toVal}
              onChange={e => setDraft(role.name, 'read_timeout_secs', e.target.value)}
              disabled={isBusy} style={inputStyle}
              title="HTTP read timeout (s). Leave blank to let the server auto-pick when raising max_tokens."
            />
            <input
              type="number" min={MIN_GPU_LAYERS} max={MAX_GPU_LAYERS} step={1}
              value={gpuVal}
              onChange={e => setDraft(role.name, 'gpu_layers', e.target.value)}
              disabled={isBusy} style={inputStyle}
              title="GPU layers offloaded to VRAM. Takes effect on next deploy."
            />
            <input
              type="number" min={MIN_CONCURRENCY} max={MAX_CONCURRENCY} step={1}
              value={concVal}
              onChange={e => setDraft(role.name, 'max_concurrency', e.target.value)}
              disabled={isBusy || role.max_concurrency === undefined} style={inputStyle}
              title={role.max_concurrency === undefined ? 'Not configurable for this agent' : 'Max concurrent requests'}
              placeholder={role.max_concurrency === undefined ? '—' : ''}
            />
            <button
              onClick={() => saveOne(role)}
              disabled={!dirty || isBusy}
              style={saveStyle}
              title={err || note || (dirty ? 'Save changes' : 'No changes')}
            >
              {isBusy ? '…' : 'Save'}
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );
}
