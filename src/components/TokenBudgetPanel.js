import React, { useState, useMemo } from 'react';
import Button from './Button';
import { setAgentTokens } from '../api/swarmApi';
import TokenBudgetGrid, {
  MIN_MAX_TOKENS, MAX_MAX_TOKENS,
  MIN_CONTEXT, MAX_CONTEXT,
  MIN_TIMEOUT, MAX_TIMEOUT,
  MIN_GPU_LAYERS, MAX_GPU_LAYERS,
  MIN_CONCURRENCY, MAX_CONCURRENCY,
} from './TokenBudgetGrid';

function clamp(n, lo, hi) {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.floor(n)));
}

export default function TokenBudgetPanel({ roles, onRolesChange, selected }) {
  const [drafts, setDrafts] = useState({});
  const [busy, setBusy] = useState({});
  const [errors, setErrors] = useState({});
  const [notices, setNotices] = useState({});
  const [showAll, setShowAll] = useState(false);

  const safeRoles = Array.isArray(roles) ? roles : [];
  const selectedSet = selected instanceof Set ? selected : null;
  const visibleRoles = (!selectedSet || showAll || selectedSet.size === 0)
    ? safeRoles
    : safeRoles.filter(r => selectedSet.has(r.name));

  const setDraft = (name, key, value) => {
    setDrafts(prev => ({ ...prev, [name]: { ...(prev[name] || {}), [key]: value } }));
  };

  const effective = (role, key) => {
    const draft = drafts[role.name];
    if (draft && draft[key] !== undefined && draft[key] !== '') return Number(draft[key]);
    return role[key];
  };

  const isDirty = (role) => {
    const d = drafts[role.name];
    if (!d) return false;
    const { max_tokens: dm, context: dc, read_timeout_secs: dt, gpu_layers: dg, max_concurrency: dmc } = d;
    return (
      (dm !== undefined && dm !== '' && Number(dm) !== role.max_tokens) ||
      (dc !== undefined && dc !== '' && Number(dc) !== role.context) ||
      (dt !== undefined && dt !== '' && Number(dt) !== role.read_timeout_secs) ||
      (dg !== undefined && dg !== '' && Number(dg) !== role.gpu_layers) ||
      (dmc !== undefined && dmc !== '' && Number(dmc) !== role.max_concurrency)
    );
  };

  const totalContext = useMemo(
    () => visibleRoles.reduce((s, r) => {
      const d = drafts[r.name];
      const val = d?.context !== undefined && d?.context !== '' ? Number(d.context) : r.context;
      return s + (val || 0);
    }, 0),
    [visibleRoles, drafts]
  );
  const totalMaxTokens = useMemo(
    () => visibleRoles.reduce((s, r) => {
      const d = drafts[r.name];
      const val = d?.max_tokens !== undefined && d?.max_tokens !== '' ? Number(d.max_tokens) : r.max_tokens;
      return s + (val || 0);
    }, 0),
    [visibleRoles, drafts]
  );

  const saveOne = async (role) => {
    const d = drafts[role.name] || {};
    const patch = {};
    if (d.max_tokens !== undefined && d.max_tokens !== '')
      patch.max_tokens = clamp(Number(d.max_tokens), MIN_MAX_TOKENS, MAX_MAX_TOKENS);
    if (d.context !== undefined && d.context !== '')
      patch.context = clamp(Number(d.context), MIN_CONTEXT, MAX_CONTEXT);
    if (d.read_timeout_secs !== undefined && d.read_timeout_secs !== '')
      patch.read_timeout_secs = clamp(Number(d.read_timeout_secs), MIN_TIMEOUT, MAX_TIMEOUT);
    if (d.gpu_layers !== undefined && d.gpu_layers !== '')
      patch.gpu_layers = clamp(Number(d.gpu_layers), MIN_GPU_LAYERS, MAX_GPU_LAYERS);
    if (d.max_concurrency !== undefined && d.max_concurrency !== '' && role.max_concurrency !== undefined)
      patch.max_concurrency = clamp(Number(d.max_concurrency), MIN_CONCURRENCY, MAX_CONCURRENCY);
    if (Object.keys(patch).length === 0) return;

    setBusy(prev => ({ ...prev, [role.name]: true }));
    setErrors(prev => ({ ...prev, [role.name]: '' }));
    setNotices(prev => ({ ...prev, [role.name]: '' }));
    try {
      const resp = await setAgentTokens(role.name, patch);
      const applied = { ...patch };
      if (Number.isFinite(resp?.read_timeout_secs)) applied.read_timeout_secs = resp.read_timeout_secs;
      if (resp?.read_timeout_auto_bumped) {
        setNotices(prev => ({
          ...prev,
          [role.name]: `read_timeout_secs auto-bumped to ${resp.read_timeout_secs}s for the new max_tokens`,
        }));
      }
      if (onRolesChange) {
        onRolesChange(prev => prev.map(r => r.name === role.name ? { ...r, ...applied } : r));
      }
      setDrafts(prev => { const next = { ...prev }; delete next[role.name]; return next; });
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
        <span style={{ opacity: 0.6 }}>showing {visibleRoles.length}/{safeRoles.length}</span>
        {selectedSet && selectedSet.size > 0 && (
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} style={{ margin: 0 }} />
            <span>show all</span>
          </label>
        )}
        <span style={{ flex: 1 }} />
        {dirtyRoles.length > 0 && (
          <Button
            variant="outline-primary"
            size="xs"
            onClick={saveAll}
            disabled={Object.values(busy).some(Boolean)}
          >
            Save all ({dirtyRoles.length})
          </Button>
        )}
      </div>

      <TokenBudgetGrid
        visibleRoles={visibleRoles}
        drafts={drafts}
        errors={errors}
        notices={notices}
        busy={busy}
        isDirty={isDirty}
        setDraft={setDraft}
        saveOne={saveOne}
      />
    </div>
  );
}
