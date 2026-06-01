import React, { useRef, useCallback } from 'react';
import { PANEL_META } from '../renderers/PanelRegistry';

export default function FreeformPanel({ panel, canvasRef, dispatch }) {
  const headerRef = useRef(null);
  const dragging   = useRef(false);
  const origin     = useRef({ mx: 0, my: 0, px: 0, py: 0 });

  const onHeaderMouseDown = useCallback((e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragging.current = true;
    origin.current = { mx: e.clientX, my: e.clientY, px: panel.x, py: panel.y };

    const onMove = (ev) => {
      if (!dragging.current) return;
      const dx = ev.clientX - origin.current.mx;
      const dy = ev.clientY - origin.current.my;
      dispatch({ type: 'MOVE_FREE_PANEL', id: panel.id, x: origin.current.px + dx, y: origin.current.py + dy });
    };
    const onUp = () => {
      dragging.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [panel.id, panel.x, panel.y, dispatch]);

  const onResizeMouseDown = useCallback((e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const startW = panel.w, startH = panel.h;
    const startX = e.clientX, startY = e.clientY;

    const onMove = (ev) => {
      const w = startW + (ev.clientX - startX);
      const h = startH + (ev.clientY - startY);
      dispatch({ type: 'RESIZE_FREE_PANEL', id: panel.id, w, h });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [panel.id, panel.w, panel.h, dispatch]);

  return (
    <div
      className="fe-panel"
      style={{ left: panel.x, top: panel.y, width: panel.w, height: panel.h, zIndex: panel.z }}
    >
      <div className="fe-panel-header" ref={headerRef} onMouseDown={onHeaderMouseDown}>
        <span className="fe-panel-title">{PANEL_META[panel.panel]?.label || panel.panel}</span>
        <button className="fe-panel-btn" onClick={() => dispatch({ type: 'BRING_FORWARD', id: panel.id })} title="Bring forward">↑</button>
        <button className="fe-panel-btn" onClick={() => dispatch({ type: 'SEND_BACK',     id: panel.id })} title="Send back">↓</button>
        <button className="fe-panel-btn fe-panel-btn--remove" onClick={() => dispatch({ type: 'REMOVE_FREE_PANEL', id: panel.id })} title="Remove">✕</button>
      </div>
      <div className="fe-panel-body">
        <div className="fe-panel-preview">
          [{PANEL_META[panel.panel]?.label || panel.panel}]<br />
          <span style={{ fontSize: 9, color: '#444' }}>{panel.w}×{panel.h} · z{panel.z}</span>
        </div>
      </div>
      <div className="fe-resize" onMouseDown={onResizeMouseDown} />
    </div>
  );
}
