import React from 'react';
import { PanelSlot } from './PanelRegistry';

/**
 * Renders a saved freeform layout definition into absolute-positioned panels.
 */
export default function FreeformLayoutRenderer({ layoutDef, appProps }) {
  const { panels } = layoutDef;
  if (!panels?.length) return (
    <div style={{ color: '#444', padding: 16, fontFamily: 'monospace', fontSize: 12 }}>
      Empty canvas layout
    </div>
  );

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#0d0d0d', overflow: 'hidden' }}>
      {panels.map(p => (
        <div
          key={p.id}
          style={{
            position: 'absolute',
            left: p.x,
            top: p.y,
            width: p.w,
            height: p.h,
            zIndex: p.z ?? 1,
            overflow: 'hidden',
            border: '1px solid #2a2a2a',
            borderRadius: 4,
            background: '#111',
          }}
        >
          <PanelSlot name={p.panel} appProps={appProps} />
        </div>
      ))}
    </div>
  );
}
