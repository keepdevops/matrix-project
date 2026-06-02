import { useState, useEffect, useCallback } from 'react';
import {
  fetchPresets, savePreset, deletePreset, applyPreset,
  fetchModeAgents, fetchActiveMode,
} from '../api/swarmApi';

async function captureCurrent() {
  const mode = await fetchActiveMode();
  if (!mode) throw new Error('No active mode to capture');
  const data = await fetchModeAgents(mode);
  const bundle = { mode };
  if (data.explicit && Array.isArray(data.agents)) bundle.agents = data.agents;
  if (typeof data.synthesizer === 'string') bundle.synthesizer = data.synthesizer;
  if (Number.isInteger(data.max_select)) bundle.max_select = data.max_select;
  return bundle;
}

export function usePresetsPanel() {
  const [presets, setPresets] = useState({});
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState(null);
  const [newName, setNewName] = useState('');
  const [savedAt, setSavedAt] = useState(null);

  const reload = useCallback(() => {
    fetchPresets().then(setPresets).catch(e => setError(e.message));
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const handleSave = async () => {
    const trimmed = newName.trim();
    if (!trimmed) { setError('Preset name required'); return; }
    setBusy(true); setError(null);
    try {
      const bundle = await captureCurrent();
      await savePreset(trimmed, bundle);
      setNewName(''); setSavedAt(Date.now()); reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleApply = async (name) => {
    setBusy(true); setError(null);
    try {
      const res = await applyPreset(name);
      if (Array.isArray(res.unknown) && res.unknown.length)
        setError(`Applied with skipped: ${res.unknown.join(', ')}`);
      window.dispatchEvent(new CustomEvent('mode-roster-changed', {
        detail: { mode: res.mode, source: 'preset', name },
      }));
      setSavedAt(Date.now());
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (name) => {
    if (!window.confirm(`Delete preset "${name}"?`)) return;
    setBusy(true); setError(null);
    try {
      await deletePreset(name);
      reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return { presets, busy, error, newName, setNewName, savedAt, handleSave, handleApply, handleDelete, reload };
}
