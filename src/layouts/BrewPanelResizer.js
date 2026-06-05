import React, { useCallback, useRef } from 'react';

// Draggable divider between the Configure (left) and Session/Preview (right)
// panels. Slides the split by setting `--brew-split` (a px width for the left
// column) on the target `.brew-body`. Persisted to localStorage; double-click
// resets to the 50/50 default.
export const SPLIT_KEY = 'brew.panelSplit';
const MIN_PX = 280; // keep both panels usable

// Apply a stored split to the body element (called on mount).
export function applyStoredSplit(el) {
  if (!el) return;
  try {
    const v = localStorage.getItem(SPLIT_KEY);
    if (v) el.style.setProperty('--brew-split', v);
  } catch (e) {
    console.error('[BrewPanelResizer] read split failed:', e);
  }
}

export default function BrewPanelResizer({ targetRef }) {
  const dragging = useRef(false);

  const onMove = useCallback((e) => {
    const el = targetRef.current;
    if (!dragging.current || !el) return;
    const rect = el.getBoundingClientRect();
    const max = rect.width - MIN_PX;
    const left = Math.max(MIN_PX, Math.min(max, e.clientX - rect.left));
    el.style.setProperty('--brew-split', `${Math.round(left)}px`);
  }, [targetRef]);

  const onUp = useCallback(() => {
    if (!dragging.current) return;
    dragging.current = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    try {
      const v = targetRef.current?.style.getPropertyValue('--brew-split');
      if (v) localStorage.setItem(SPLIT_KEY, v);
    } catch (e) {
      console.error('[BrewPanelResizer] persist split failed:', e);
    }
  }, [onMove, targetRef]);

  const onDown = useCallback((e) => {
    e.preventDefault();
    dragging.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [onMove, onUp]);

  const onReset = useCallback(() => {
    targetRef.current?.style.removeProperty('--brew-split');
    try {
      localStorage.removeItem(SPLIT_KEY);
    } catch (e) {
      console.error('[BrewPanelResizer] reset split failed:', e);
    }
  }, [targetRef]);

  // Keyboard: arrow keys nudge the split for accessibility.
  const onKeyDown = useCallback((e) => {
    const el = targetRef.current;
    if (!el || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    e.preventDefault();
    const rect = el.getBoundingClientRect();
    const cur = parseInt(el.style.getPropertyValue('--brew-split'), 10)
      || Math.round(rect.width / 2);
    const max = rect.width - MIN_PX;
    const next = Math.max(MIN_PX, Math.min(max, cur + (e.key === 'ArrowLeft' ? -24 : 24)));
    el.style.setProperty('--brew-split', `${next}px`);
    try { localStorage.setItem(SPLIT_KEY, `${next}px`); } catch (err) { /* non-fatal */ }
  }, [targetRef]);

  return (
    <div
      className="brew-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panels"
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onMouseDown={onDown}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
    >
      <span className="brew-resizer-grip" aria-hidden="true" />
    </div>
  );
}
