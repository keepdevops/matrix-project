import React, { useState } from 'react';
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import { useEditor } from '../EditorContext';
import { PANEL_META, PANEL_NAMES } from '../renderers/PanelRegistry';
import { GRID_TEMPLATES } from './GridTemplates';
import { PanelChip, SlotZone } from './GridEditorPanels';
import './GridEditor.css';

export default function GridEditor() {
  const { state, dispatch } = useEditor();
  const [activeChip, setActiveChip] = useState(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const tpl = GRID_TEMPLATES[state.activeTemplate];
  const slotNames = [...new Set(tpl.areas.flat().filter(s => s !== '.'))];

  const gridStyle = {
    gridTemplateAreas: tpl.areas.map(row => `"${row.join(' ')}"`).join('\n'),
    gridTemplateRows: tpl.rows.join(' '),
    gridTemplateColumns: tpl.cols.join(' '),
  };

  const handleDragStart = ({ active }) => {
    setActiveChip(active.id.replace(/^chip-/, ''));
  };

  const handleDragEnd = ({ active, over }) => {
    setActiveChip(null);
    if (!over) return;
    const panel = active.id.replace(/^chip-/, '');
    if (slotNames.includes(over.id))
      dispatch({ type: 'SET_SLOT', slot: over.id, panel });
  };

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="ge-root">
        <div className="ge-palette">
          <div className="ge-palette-header">Panels</div>
          <div className="ge-palette-list">
            {PANEL_NAMES.map(name => (
              <PanelChip key={name} name={name} isDragging={activeChip === name} />
            ))}
          </div>
          <div className="ge-template-picker">
            <div className="ge-tpl-label">Template</div>
            <div className="ge-tpl-btns">
              {Object.keys(GRID_TEMPLATES).map(k => (
                <button
                  key={k}
                  className={`ge-tpl-btn${state.activeTemplate === k ? ' ge-tpl-btn--active' : ''}`}
                  onClick={() => dispatch({ type: 'SET_TEMPLATE', key: k })}
                >
                  {GRID_TEMPLATES[k].label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="ge-grid-area">
          <div className="ge-grid" style={gridStyle}>
            {slotNames.map(slot => (
              <SlotZone
                key={slot}
                slotName={slot}
                panelName={state.slots[slot] || null}
                onClear={() => dispatch({ type: 'CLEAR_SLOT', slot })}
              />
            ))}
          </div>
        </div>
      </div>

      <DragOverlay>
        {activeChip
          ? <div className="ge-drag-overlay">{PANEL_META[activeChip]?.label || activeChip}</div>
          : null}
      </DragOverlay>
    </DndContext>
  );
}
