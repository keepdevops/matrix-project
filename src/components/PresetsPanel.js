import React from 'react';
import Button from './Button';
import PresetRow from './PresetRow';
import PresetImport from './PresetImport';
import { usePresetsPanel } from './usePresetsPanel';

export default function PresetsPanel() {
  const {
    presets, busy, error, newName, setNewName, savedAt,
    handleSave, handleApply, handleDelete, reload,
  } = usePresetsPanel();

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
            onApply={handleApply} onDelete={handleDelete}
            onDuplicated={reload} />
        ))}
      </div>

      <PresetImport onImported={reload} />

      <div style={{ marginTop: '0.5rem', fontSize: '0.78rem', minHeight: '1.1rem' }}>
        {error && <span style={{ color: 'var(--brew-kv-crit, #e55)' }}>{error}</span>}
        {!error && savedAt && (
          <span style={{ opacity: 0.7 }}>updated {new Date(savedAt).toLocaleTimeString()}</span>
        )}
      </div>
    </div>
  );
}
