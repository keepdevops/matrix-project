import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import TokenBudgetPanel from '../components/TokenBudgetPanel';

export default function BrewAgentsPopout({
  open,
  onClose,
  roles,
  selected,
  onRolesChange,
}) {
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (rootRef.current?.contains(e.target)) return;
      if (e.target.closest?.('.brew-agents-popout-trigger')) return;
      onClose?.();
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  // Portal to <body> so no overflow:hidden ancestor (the configure section is
  // position:relative + overflow:hidden) can clip the panel or its scroll area.
  return createPortal(
    <div ref={rootRef} className="brew-agents-popout" role="dialog" aria-label="Agent token budgets">
      <div className="brew-agents-popout-header">
        <span className="brew-agents-popout-title">Token Budgets</span>
        <button type="button" className="brew-header-btn" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <div className="brew-agents-popout-body brew-token-budget-wrap">
        <TokenBudgetPanel roles={roles} onRolesChange={onRolesChange} selected={selected} />
      </div>
    </div>,
    document.body,
  );
}
