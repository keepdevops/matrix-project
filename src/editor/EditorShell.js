import React, { useState } from 'react';
import { useEditor } from './EditorContext';
import { saveCustomLayout, makeId } from './persistence/customLayouts';
import { saveFlowConfig, deriveMode } from './persistence/flowConfigs';
import { registerCustomLayout } from '../layouts/registry';
import CustomLayoutWrapper from '../layouts/CustomLayoutWrapper';
import { GRID_TEMPLATES } from './grid/GridTemplates';
import GridEditor from './grid/GridEditor';
import FreeformEditor from './freeform/FreeformEditor';
import FlowEditor from './flow/FlowEditor';
import './EditorShell.css';

const TABS = [
  { key: 'grid',     label: '⊞ Grid' },
  { key: 'freeform', label: '⊡ Canvas' },
  { key: 'flow',     label: '⬡ Flow' },
];

export default function EditorShell() {
  const { state, dispatch } = useEditor();
  const [toast, setToast] = useState(null);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  };

  const handleSave = () => {
    if (state.mode === 'flow') {
      const derived = deriveMode(state.flowNodes, state.flowEdges);
      saveFlowConfig({
        id: state.flowId,
        label: state.layoutName,
        nodes: state.flowNodes,
        edges: state.flowEdges,
        derivedMode: derived,
      });
      showToast(`Flow saved — derived mode: ${derived}`);
      return;
    }

    const id = state.layoutId;
    const def = state.mode === 'grid'
      ? {
          id,
          type: 'grid',
          label: state.layoutName,
          createdAt: Date.now(),
          gridDef: GRID_TEMPLATES[state.activeTemplate],
          slots: state.slots,
        }
      : {
          id,
          type: 'freeform',
          label: state.layoutName,
          createdAt: Date.now(),
          panels: state.freePanels,
        };

    saveCustomLayout(def);
    registerCustomLayout(
      def.id,
      def.label,
      (props) => React.createElement(CustomLayoutWrapper, { layoutId: def.id, ...props }),
    );
    showToast(`Layout "${def.label}" saved — select it in the app`);
  };

  return (
    <div className="editor-root">
      <div className="editor-topbar">
        <span className="editor-brand">Matrix</span>
        <span className="editor-brand-sub">Layout Editor</span>
        <span className="editor-topbar-spacer" />
        <input
          className="editor-name-input"
          value={state.layoutName}
          onChange={e => dispatch({ type: 'SET_NAME', name: e.target.value })}
          placeholder="Layout name…"
        />
        <button className="editor-btn editor-btn--primary" onClick={handleSave}>
          ✦ Save
        </button>
        <a className="editor-back-link" href="/">← App</a>
      </div>

      <div className="editor-tabs">
        {TABS.map(t => (
          <button
            key={t.key}
            className={`editor-tab${state.mode === t.key ? ' editor-tab--active' : ''}`}
            onClick={() => dispatch({ type: 'SET_MODE', mode: t.key })}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="editor-canvas">
        {state.mode === 'grid'     && <GridEditor />}
        {state.mode === 'freeform' && <FreeformEditor />}
        {state.mode === 'flow'     && <FlowEditor />}
      </div>

      {toast && <div className="editor-toast">{toast}</div>}
    </div>
  );
}
