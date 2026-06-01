import React, { useState, useEffect, useCallback } from 'react';
import Button from './Button';
import PresetRow from './PresetRow';
import {
  fetchPresets, savePreset, deletePreset, applyPreset,
  fetchModeAgents, fetchActiveMode,
} from '../api/swarmApi';

export default function PresetsPanel() {
  const [presets, setPresets] = useState({});
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState(null);
  const [newName, setNewName] = useState('');
  const [savedAt, setSavedAt] = useState(null);

  const reload = useCallback(() => {
    fetchPresets().then(setPresets).catch(e => setError(e.message));
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const captureCurrent = async () => {
    const mode = await fetchActiveMode();
    if (!mode) throw new Error('No active mode to capture');
    const data = await fetchModeAgents(mode);
    const bundle = { mode };
    if (data.explicit && Array.isArray(data.agents)) bundle.agents = data.agents;
    if (typeof data.synthesizer === 'string') bundle.synthesizer = data.synthesizer;
    if (Number.isInteger(data.max_select)) bundle.max_select = data.max_select;
    return bundle;
  };

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

  return (
    <div className="swarm-config-section" style={{ padding: '0.75rem' }}>
      <div className="swarm-config-title">PRESETS</div>
      <div style={{ fontSize: '0.8rem', opacity: 0.7, marginBottom: '0.5rem' }}>
        Named bundles of mode + roster + synthesizer + max_select.
        Save the active mode's current settings, apply later in one click.
      </div>

      <div style={{ display: 'flex', gap: '0.3rem', marginBottom: '0.6rem' }}>
        <input
          type="text" placeholder="preset name (e.g. design-review)"
          value={newName} onChange={e => setNewName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSave(); }}
          style={{ flex: 1, padding: '0.25rem 0.4rem', fontSize: '0.85rem' }}
        />
        <Button variant="outline-primary" size="sm"
          onClick={handleSave} disabled={busy || !newName.trim()}>
          Save active as preset
        </Button>
      </div>

      {Object.keys(presets).length === 0 && (
        <div className="presets-empty">— no presets yet —</div>
      )}

      <div className="presets-list">
        {Object.entries(presets).map(([name, bundle]) => (
          <PresetRow key={name} name={name} bundle={bundle} busy={busy}
            onApply={handleApply} onDelete={handleDelete} />
        ))}
      </div>

      <div style={{ marginTop: '0.5rem', fontSize: '0.78rem', minHeight: '1.1rem' }}>
        {error && <span style={{ color: 'var(--brew-kv-crit, #e55)' }}>{error}</span>}
        {!error && savedAt && (
          <span style={{ opacity: 0.7 }}>updated {new Date(savedAt).toLocaleTimeString()}</span>
        )}
      </div>
    </div>
  );
}
