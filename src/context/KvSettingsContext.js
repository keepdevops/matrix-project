import React, { createContext, useContext, useEffect, useState } from 'react';

// User-tunable KV pressure settings (warn/crit thresholds, poll cadence).
// Consumed by KvPressureGauge for display, and by SwarmConfig for the editor UI.
const STORAGE_KEY = 'swarm-matrix-kv-settings';

const DEFAULTS = {
  warnPct: 70,
  critPct: 90,
  pollSec: 5,
};

function loadInitial() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw);
    return {
      warnPct: Number.isFinite(parsed.warnPct) ? parsed.warnPct : DEFAULTS.warnPct,
      critPct: Number.isFinite(parsed.critPct) ? parsed.critPct : DEFAULTS.critPct,
      pollSec: Number.isFinite(parsed.pollSec) ? parsed.pollSec : DEFAULTS.pollSec,
    };
  } catch (err) {
    console.error('Failed to read KV settings from localStorage:', err);
    return DEFAULTS;
  }
}

const KvSettingsContext = createContext({
  ...DEFAULTS,
  setWarnPct: () => {},
  setCritPct: () => {},
  setPollSec: () => {},
});

export function KvSettingsProvider({ children }) {
  const [settings, setSettings] = useState(loadInitial);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (err) {
      console.error('Failed to persist KV settings:', err);
    }
  }, [settings]);

  const value = {
    ...settings,
    setWarnPct: v => setSettings(s => ({ ...s, warnPct: v })),
    setCritPct: v => setSettings(s => ({ ...s, critPct: v })),
    setPollSec: v => setSettings(s => ({ ...s, pollSec: v })),
  };

  return (
    <KvSettingsContext.Provider value={value}>
      {children}
    </KvSettingsContext.Provider>
  );
}

export function useKvSettings() {
  return useContext(KvSettingsContext);
}

export default KvSettingsContext;
