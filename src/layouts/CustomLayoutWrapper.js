import React from 'react';
import { getCustomLayout } from '../editor/persistence/customLayouts';
import GridLayoutRenderer from '../editor/renderers/GridLayoutRenderer';
import FreeformLayoutRenderer from '../editor/renderers/FreeformLayoutRenderer';

/**
 * Runtime wrapper for layouts saved in the visual editor.
 * Loads the persisted definition by id and delegates to the
 * appropriate renderer (grid or freeform).
 */
export default function CustomLayoutWrapper({ layoutId, ...appProps }) {
  const def = getCustomLayout(layoutId);

  if (!def) {
    return (
      <div style={{ color: 'var(--color-danger, #ef4444)', padding: 16, fontFamily: 'monospace' }}>
        Custom layout &quot;{layoutId}&quot; not found — open the editor to recreate it.
      </div>
    );
  }

  if (def.type === 'grid') {
    return <GridLayoutRenderer layoutDef={def} appProps={appProps} />;
  }
  if (def.type === 'freeform') {
    return <FreeformLayoutRenderer layoutDef={def} appProps={appProps} />;
  }

  return (
    <div style={{ color: 'var(--color-danger, #ef4444)', padding: 16, fontFamily: 'monospace' }}>
      Unknown layout type: {def.type}
    </div>
  );
}
