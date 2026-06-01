import React, { useRef } from 'react';
import { useEditor } from '../EditorContext';
import { PANEL_META, PANEL_NAMES } from '../renderers/PanelRegistry';
import FreeformPanel from './FreeformPanel';
import './FreeformEditor.css';

export default function FreeformEditor() {
  const { state, dispatch } = useEditor();
  const canvasRef = useRef(null);
  const placedNames = new Set(state.freePanels.map(p => p.panel));

  return (
    <div className="fe-root">
      <div className="fe-palette">
        <div className="fe-palette-header">Panels</div>
        <div className="fe-palette-list">
          {PANEL_NAMES.map(name => (
            <button
              key={name}
              className={`fe-add-btn${placedNames.has(name) ? ' fe-add-btn--active' : ''}`}
              onClick={() => dispatch({ type: 'ADD_FREE_PANEL', panel: name })}
              disabled={placedNames.has(name)}
            >
              + {PANEL_META[name]?.label || name}
            </button>
          ))}
        </div>
      </div>

      <div className="fe-canvas" ref={canvasRef}>
        {state.freePanels.map(panel => (
          <FreeformPanel
            key={panel.id}
            panel={panel}
            canvasRef={canvasRef}
            dispatch={dispatch}
          />
        ))}
        {state.freePanels.length === 0 && (
          <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', color: '#333', fontFamily: 'monospace', fontSize: 12, textAlign: 'center', pointerEvents: 'none' }}>
            ← Add panels from the palette
          </div>
        )}
      </div>
    </div>
  );
}
