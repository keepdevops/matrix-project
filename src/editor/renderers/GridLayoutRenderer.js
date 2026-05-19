import React from 'react';
import { PanelSlot } from './PanelRegistry';

/**
 * Renders a saved grid layout definition into a live CSS-grid layout.
 * Used both by the editor preview and by CustomLayoutWrapper in production.
 */
export default function GridLayoutRenderer({ layoutDef, appProps }) {
  const { gridDef, slots } = layoutDef;
  if (!gridDef) return <div style={{ color: '#f55', padding: 16 }}>Invalid grid layout</div>;

  const areas = gridDef.areas.map(row => `"${row.join(' ')}"`).join('\n');

  const containerStyle = {
    display: 'grid',
    gridTemplateAreas: areas,
    gridTemplateRows: (gridDef.rows || []).join(' ') || 'auto',
    gridTemplateColumns: (gridDef.cols || []).join(' ') || '1fr',
    width: '100%',
    height: '100%',
    gap: '4px',
    padding: '4px',
    background: '#0d0d0d',
    overflow: 'hidden',
    boxSizing: 'border-box',
  };

  // Collect all unique slot names from the areas matrix
  const slotNames = [...new Set(gridDef.areas.flat().filter(s => s !== '.'))];

  return (
    <div style={containerStyle}>
      {slotNames.map(slotName => {
        const panelName = slots?.[slotName];
        return (
          <div
            key={slotName}
            style={{
              gridArea: slotName,
              overflow: 'hidden',
              border: '1px solid #2a2a2a',
              borderRadius: 4,
              background: '#111',
              minHeight: 0,
            }}
          >
            {panelName
              ? <PanelSlot name={panelName} appProps={appProps} />
              : <div style={{ color: '#444', padding: 8, fontSize: 11, fontFamily: 'monospace' }}>
                  [{slotName}]
                </div>
            }
          </div>
        );
      })}
    </div>
  );
}
