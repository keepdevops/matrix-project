import React, { useState, useMemo } from 'react';
import { setAgentTokens } from '../api/swarmApi';

// Per-agent token-budget editor. Shows max_tokens (runtime — applies to next
// inference call) and context (persisted, takes effect on next deploy) for
// every agent in the loaded swarm config. Saves one row at a time via
// PUT /api/agents/<name>/tokens.
//
// Why this matters: changing max_tokens used to require hand-editing the
// swarm-config.json file and restarting the swarm. With this panel a user
// can bump architect/programmer output caps when code is getting truncated
// mid-generation, without leaving the UI.

const MIN_MAX_TOKENS = 64;
const MAX_MAX_TOKENS = 131072;
const MIN_CONTEXT = 512;
const MAX_CONTEXT = 262144;
const MIN_TIMEOUT = 30;
const MAX_TIMEOUT = 7200;

function clamp(n, lo, hi) {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.floor(n)));
}

export default function TokenBudgetPanel({ roles, onRolesChange, selected }) {
  const [drafts, setDrafts] = useState({}); // { name: { max_tokens, context, read_timeout_secs } }
  const [busy, setBusy] = useState({});      // { name: bool }
  const [errors, setErrors] = useState({});  // { name: string }
  const [notices, setNotices] = useState({}); // { name: string } — e.g. auto-bump info
  const [showAll, setShowAll] = useState(false);

  const safeRoles = Array.isArray(roles) ? roles : [];
  const selectedSet = selected instanceof Set ? selected : null;
  const visibleRoles = (!selectedSet || showAll || selectedSet.size === 0)
    ? safeRoles
    : safeRoles.filter(r => selectedSet.has(r.name));

  const setDraft = (name, key, value) => {
    setDrafts(prev => ({
      ...prev,
      [name]: { ...(prev[name] || {}), [key]: value },
    }));
  };

  const effective = (role, key) => {
    const draft = drafts[role.name];
    if (draft && draft[key] !== undefined && draft[key] !== '') return Number(draft[key]);
    return role[key];
  };

  const isDirty = (role) => {
    const d = drafts[role.name];
    if (!d) return false;
    const dm = d.max_tokens, dc = d.context, dt = d.read_timeout_secs;
    const changed =
      (dm !== undefined && dm !== '' && Number(dm) !== role.max_tokens) ||
      (dc !== undefined && dc !== '' && Number(dc) !== role.context) ||
      (dt !== undefined && dt !== '' && Number(dt) !== role.read_timeout_secs);
    return changed;
  };

  const totalContext = useMemo(
    () => visibleRoles.reduce((s, r) => s + (effective(r, 'context') || 0), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visibleRoles, drafts]
  );
  const totalMaxTokens = useMemo(
    () => visibleRoles.reduce((s, r) => s + (effective(r, 'max_tokens') || 0), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visibleRoles, drafts]
  );

  const saveOne = async (role) => {
    const d = drafts[role.name] || {};
    const patch = {};
    if (d.max_tokens !== undefined && d.max_tokens !== '') {
      patch.max_tokens = clamp(Number(d.max_tokens), MIN_MAX_TOKENS, MAX_MAX_TOKENS);
    }
    if (d.context !== undefined && d.context !== '') {
      patch.context = clamp(Number(d.context), MIN_CONTEXT, MAX_CONTEXT);
    }
    if (d.read_timeout_secs !== undefined && d.read_timeout_secs !== '') {
      patch.read_timeout_secs = clamp(Number(d.read_timeout_secs), MIN_TIMEOUT, MAX_TIMEOUT);
    }
    if (Object.keys(patch).length === 0) return;

    setBusy(prev => ({ ...prev, [role.name]: true }));
    setErrors(prev => ({ ...prev, [role.name]: '' }));
    setNotices(prev => ({ ...prev, [role.name]: '' }));
    try {
      const resp = await setAgentTokens(role.name, patch);
      // Apply server response (which may contain auto-bumped read_timeout_secs)
      const applied = { ...patch };
      if (Number.isFinite(resp?.read_timeout_secs)) {
        applied.read_timeout_secs = resp.read_timeout_secs;
      }
      if (resp?.read_timeout_auto_bumped) {
        setNotices(prev => ({
          ...prev,
          [role.name]: `read_timeout_secs auto-bumped to ${resp.read_timeout_secs}s for the new max_tokens`,
        }));
      }
      if (onRolesChange) {
        onRolesChange(prev => prev.map(r =>
          r.name === role.name ? { ...r, ...applied } : r
        ));
      }
      setDrafts(prev => {
        const next = { ...prev };
        delete next[role.name];
        return next;
      });
    } catch (e) {
      setErrors(prev => ({ ...prev, [role.name]: e.message }));
    } finally {
      setBusy(prev => ({ ...prev, [role.name]: false }));
    }
  };

  const dirtyRoles = visibleRoles.filter(isDirty);

  if (safeRoles.length === 0) return null;

  const saveAll = async () => {
    for (const r of dirtyRoles) {
      // sequential to keep error reporting per-agent and not overload the proxy
      // eslint-disable-next-line no-await-in-loop
      await saveOne(r);
    }
  };

  return (
    <div className="swarm-config-section" style={{ padding: '0.75rem' }}>
      <div className="swarm-config-title">TOKEN BUDGETS</div>
      <div style={{ fontSize: '0.74rem', opacity: 0.65, marginBottom: '0.4rem' }}>
        <code>max_tok</code> (output cap, immediate) · <code>ctx</code> (window, on redeploy) ·{' '}
        <code>to</code> (HTTP timeout, auto-bumped if max_tok &gt; 4096).
      </div>

      <div style={{
        display: 'flex', gap: '0.6rem', fontSize: '0.74rem', opacity: 0.85,
        marginBottom: '0.35rem', alignItems: 'center', flexWrap: 'wrap',
      }}>
        <span>Σ ctx: <strong>{totalContext.toLocaleString()}</strong></span>
        <span>Σ out: <strong>{totalMaxTokens.toLocaleString()}</strong></span>
        <span style={{ opacity: 0.6 }}>
          showing {visibleRoles.length}/{safeRoles.length}
        </span>
        {selectedSet && selectedSet.size > 0 && (
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={showAll}
              onChange={e => setShowAll(e.target.checked)}
              style={{ margin: 0 }}
            />
            <span>show all</span>
          </label>
        )}
        <span style={{ flex: 1 }} />
        {dirtyRoles.length > 0 && (
          <button
            onClick={saveAll}
            className="swarm-deploy-btn"
            style={{ padding: '0.15rem 0.5rem', fontSize: '0.74rem' }}
            disabled={Object.values(busy).some(Boolean)}
          >
            Save all ({dirtyRoles.length})
          </button>
        )}
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 5rem 5rem 4.25rem 3.25rem',
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
        <div />
        {visibleRoles.map(role => {
          const dirty = isDirty(role);
          const err = errors[role.name];
          const note = notices[role.name];
          const isBusy = !!busy[role.name];
          const ctxVal = drafts[role.name]?.context ?? role.context ?? '';
          const mtVal = drafts[role.name]?.max_tokens ?? role.max_tokens ?? '';
          const toVal = drafts[role.name]?.read_timeout_secs ?? role.read_timeout_secs ?? '';
          const inputStyle = {
            padding: '0.05rem 0.25rem',
            fontSize: '0.78rem',
            width: '100%',
            lineHeight: 1.2,
          };
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

    </div>
  );
}
