import { useState, useEffect } from 'react';
import { LAYOUTS, THEMES } from '../layouts/registry';

const STORAGE_LAYOUT = 'swarm-matrix-layout';
const STORAGE_THEME  = 'swarm-matrix-theme';
const DEFAULT_LAYOUT = 'brewlate';
const DEFAULT_THEME  = 'dark';

function readParam(name) {
  try {
    return new URLSearchParams(window.location.search).get(name) || null;
  } catch {
    return null;
  }
}

function readStorage(key) {
  try { return localStorage.getItem(key) || null; } catch { return null; }
}

function writeStorage(key, value) {
  try { localStorage.setItem(key, value); } catch (err) {
    console.error('useLayoutPreference: localStorage write failed:', err);
  }
}

function syncUrl(layout, theme) {
  try {
    const params = new URLSearchParams(window.location.search);
    params.set('layout', layout);
    params.set('theme', theme);
    window.history.replaceState(null, '', `${window.location.pathname}?${params}`);
  } catch (err) {
    console.error('useLayoutPreference: URL sync failed:', err);
  }
}

function normalizeLayoutId(id) {
  if (!id || id === 'default') return DEFAULT_LAYOUT;
  return id;
}

function resolve(paramVal, storageVal, valid, def) {
  const fromParam = normalizeLayoutId(paramVal);
  const fromStorage = normalizeLayoutId(storageVal);
  if (fromParam && valid[fromParam]) return fromParam;
  if (fromStorage && valid[fromStorage]) return fromStorage;
  // system preference fallback for theme only
  if (def === DEFAULT_THEME) {
    return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  return def;
}

export function useLayoutPreference() {
  const [layout, setLayoutState] = useState(() =>
    resolve(readParam('layout'), readStorage(STORAGE_LAYOUT), LAYOUTS, DEFAULT_LAYOUT)
  );
  const [theme, setThemeState] = useState(() =>
    resolve(readParam('theme'), readStorage(STORAGE_THEME), THEMES, DEFAULT_THEME)
  );

  useEffect(() => {
    document.body.setAttribute('data-theme', theme);
    document.body.setAttribute('data-layout', layout);
    writeStorage(STORAGE_THEME, theme);
    syncUrl(layout, theme);
  }, [theme, layout]);

  const setLayout = (id) => {
    const normalized = normalizeLayoutId(id);
    const safe = LAYOUTS[normalized] ? normalized : DEFAULT_LAYOUT;
    setLayoutState(safe);
    writeStorage(STORAGE_LAYOUT, safe);
  };

  const setTheme = (id) => {
    const safe = THEMES[id] ? id : DEFAULT_THEME;
    document.body.setAttribute('data-theme', safe); // instant — no flash before effect fires
    setThemeState(safe);
    // storage write handled by the effect to avoid writing twice
  };

  return { layout, theme, setLayout, setTheme };
}
