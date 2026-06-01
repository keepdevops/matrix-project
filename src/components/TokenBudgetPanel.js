import React, { useMemo, useState } from 'react';
import Button from './Button';
import TokenBudgetGrid from './TokenBudgetGrid';
import { useTokenBudgetSave } from './useTokenBudgetSave';

export default function TokenBudgetPanel({ roles, onRolesChange, selected }) {
  const [showAll, setShowAll] = useState(false);
  const { drafts, busy, errors, notices, setDraft, isDirty, saveOne, saveAll } =
    useTokenBudgetSave({ onRolesChange });

  const safeRoles  = Array.isArray(roles) ? roles : [];
  const selectedSet = selected instanceof Set ? selected : null;
  const visibleRoles = (!selectedSet || showAll || selectedSet.size === 0)
    ? safeRoles
    : safeRoles.filter(r => selectedSet.has(r.name));

  const totalContext = useMemo(
    () => visibleRoles.reduce((s, r) => {
      const d = drafts[r.name];
      const val = d?.context !== undefined && d?.context !== '' ? Number(d.context) : r.context;
      return s + (val || 0);
    }, 0),
    [visibleRoles, drafts],
  );
  const totalMaxTokens = useMemo(
    () => visibleRoles.reduce((s, r) => {
      const d = drafts[r.name];
      const val = d?.max_tokens !== undefined && d?.max_tokens !== '' ? Number(d.max_tokens) : r.max_tokens;
      return s + (val || 0);
    }, 0),
    [visibleRoles, drafts],
  );

  const dirtyRoles = visibleRoles.filter(isDirty);
  if (safeRoles.length === 0) return null;

  return (
    <div className="swarm-config-section" style={{ padding: '0.75rem' }}>
      <div className="swarm-config-title">TOKEN BUDGETS</div>
      <div style={{ fontSize: '0.74rem', opacity: 0.65, marginBottom: '0.4rem' }}>
        <code>max_tok</code> (output cap, immediate) · <code>ctx</code> (window, on redeploy) ·{' '}
        <code>to</code> (HTTP timeout, auto-bumped if max_tok &gt; 4096).
      </div>

      <div style={{ display: 'flex', gap: '0.6rem', fontSize: '0.74rem', opacity: 0.85,
        marginBottom: '0.35rem', alignItems: 'center', flexWrap: 'wrap' }}>
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
          <Button variant="outline-primary" size="xs"
            onClick={() => saveAll(dirtyRoles)}
            disabled={Object.values(busy).some(Boolean)}>
            Save all ({dirtyRoles.length})
          </Button>
        )}
      </div>

      <TokenBudgetGrid
        visibleRoles={visibleRoles} drafts={drafts}
        errors={errors} notices={notices} busy={busy}
        isDirty={isDirty} setDraft={setDraft} saveOne={saveOne}
      />
    </div>
  );
}
