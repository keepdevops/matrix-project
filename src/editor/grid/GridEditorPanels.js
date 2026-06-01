import React from 'react';
import { useDroppable, useDraggable } from '@dnd-kit/core';
import { PANEL_META } from '../renderers/PanelRegistry';

export function PanelChip({ name, isDragging }) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id: `chip-${name}` });
  return (
    <div
      ref={setNodeRef}
      className={`ge-panel-chip${isDragging ? ' ge-panel-chip--dragging' : ''}`}
      {...listeners}
      {...attributes}
    >
      {PANEL_META[name]?.label || name}
    </div>
  );
}

export function SlotZone({ slotName, panelName, onClear }) {
  const { isOver, setNodeRef } = useDroppable({ id: slotName });
  return (
    <div
      ref={setNodeRef}
      className={`ge-slot${isOver ? ' ge-slot--over' : ''}${panelName ? ' ge-slot--filled' : ''}`}
      style={{ gridArea: slotName }}
    >
      <span className="ge-slot-label">{slotName}</span>
      {panelName
        ? <>
            <span className="ge-slot-panel">{PANEL_META[panelName]?.label || panelName}</span>
            <button className="ge-slot-clear" onClick={onClear} title="Clear slot">✕</button>
          </>
        : <span className="ge-slot-hint">drop panel here</span>
      }
    </div>
  );
}
