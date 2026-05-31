import React, { useState, useEffect, useCallback } from 'react';
import Button from './Button';
import {
  fetchPresets,
  savePreset,
  deletePreset,
  applyPreset,
  fetchModeAgents,
  fetchActiveMode,
} from '../api/swarmApi';

// Preset library: named bundles of (mode, agents[], synthesizer?, max_select?).
// Save current mode state under a name, apply a preset (loads it into the
// referenced mode + sets active), or delete one.
//
// On apply, dispatches a `mode-roster-changed` window event so sibling panels
// (ModeRosterPanel) can refetch their config without prop wiring.
export default function PresetsPanel() {
  const [presets, setPresets] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [newName, setNewName] = useState('');
  const [savedAt, setSavedAt] = useState(null);

  const reload = useCallback(() => {
    fetchPresets().then(setPresets).catch(e => setError(e.message));
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const captureCurrent = async () => {
    // Build a bundle from the active mode's current settings.
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
    if (!trimmed) {
      setError('Preset name required');
      return;
    }
    setBusy(true); setError(null);
    try {
      const bundle = await captureCurrent();
      await savePreset(trimmed, bundle);
      setNewName('');
      setSavedAt(Date.now());
      reload();
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
      if (Array.isArray(res.unknown) && res.unknown.length) {
        setError(`Applied with skipped: ${res.unknown.join(', ')}`);
      }
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

  const presetEntries = Object.entries(presets);

  return (
    <div className="swarm-config-section" style={{ padding: '0.75rem' }}>
      <div className="swarm-config-title">PRESETS</div>
      <div style={{ fontSize: '0.8rem', opacity: 0.7, marginBottom: '0.5rem' }}>
        Named bundles of mode + roster + synthesizer + max_select.
        Save the active mode's current settings, apply later in one click.
      </div>

      <div style={{ display: 'flex', gap: '0.3rem', marginBottom: '0.6rem' }}>
        <input
          type="text"
          placeholder="preset name (e.g. design-review)"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSave(); }}
          style={{ flex: 1, padding: '0.25rem 0.4rem', fontSize: '0.85rem' }}
        />
        <Button
          variant="outline-primary"
          size="sm"
          onClick={handleSave}
          disabled={busy || !newName.trim()}
        >
          Save active as preset
        </Button>
      </div>

      {presetEntries.length === 0 && (
        <div className="presets-empty">— no presets yet —</div>
      )}

      <div className="presets-list">
        {presetEntries.map(([name, bundle]) => (
          <div key={name} className="preset-row">
            <div className="preset-row-info">
              <div className="preset-row-name">{name}</div>
              <div className="preset-row-meta">
                mode={bundle.mode}
                {Array.isArray(bundle.agents) && ` · ${bundle.agents.length} agent${bundle.agents.length === 1 ? '' : 's'}`}
                {bundle.synthesizer && ` · synth=${bundle.synthesizer}`}
                {Number.isInteger(bundle.max_select) && ` · max=${bundle.max_select}`}
              </div>
            </div>
            <Button
              variant="outline-primary"
              size="sm"
              className="preset-row-apply"
              onClick={() => handleApply(name)}
              disabled={busy}
            >
              Apply
            </Button>
            <Button
              variant="outline-error"
              size="xs"
              className="preset-row-delete"
              onClick={() => handleDelete(name)}
              disabled={busy}
            >
              ✕
            </Button>
          </div>
        ))}
      </div>

      <div style={{ marginTop: '0.5rem', fontSize: '0.78rem',
                    minHeight: '1.1rem' }}>
        {error && <span style={{ color: 'var(--brew-kv-crit, #e55)' }}>{error}</span>}
        {!error && savedAt && (
          <span style={{ opacity: 0.7 }}>
            updated {new Date(savedAt).toLocaleTimeString()}
          </span>
        )}
      </div>
    </div>
  );
}
