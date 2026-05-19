import React from 'react';
import { loadCustomLayouts } from './customLayouts';
import { registerCustomLayout } from '../../layouts/registry';
import CustomLayoutWrapper from '../../layouts/CustomLayoutWrapper';

// Synchronous registration — runs at module import time so LAYOUTS is populated
// before useLayoutPreference reads it for the initial state.
function registerAll() {
  try {
    loadCustomLayouts().forEach(def => {
      registerCustomLayout(
        def.id,
        def.label || def.id,
        (props) => React.createElement(CustomLayoutWrapper, { layoutId: def.id, ...props }),
      );
    });
  } catch (err) {
    console.error('useCustomLayouts: registration failed', err);
  }
}
registerAll();

/**
 * Hook that keeps the in-memory LAYOUTS in sync with localStorage.
 * Call once at the App level. Re-registers whenever the storage key changes
 * (e.g. after the editor saves a new layout).
 */
export function useCustomLayouts() {
  React.useEffect(() => {
    const handler = (e) => {
      if (e.key === 'smx-custom-layouts') registerAll();
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);
}
