import React from 'react';
import { ENGINES, PROFILES } from '../components/SwarmConfig.helpers';

export default function BrewConfigEngineProfile({
  models, engine, handleEngineChange, activeProfile, applyProfile, reset,
}) {
  return (
    <>
      <div className="brew-section">
        <div className="brew-section-header">
          <span className="brew-section-title">Engines</span>
        </div>
        <div className="brew-section-body">
          <div className="brew-engine-pills">
            {ENGINES.map(e => {
              const count = models.filter(m => m.backend === e.backend).length;
              return (
                <button
                  key={e.id}
                  type="button"
                  className={`brew-engine-pill${engine === e.id ? ' active' : ''}${count === 0 ? ' disabled' : ''}`}
                  onClick={() => count > 0 && handleEngineChange(e.id)}
                  title={`${count} model${count !== 1 ? 's' : ''} available`}
                >
                  {e.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="brew-section">
        <div className="brew-section-header">
          <span className="brew-section-title">Profile</span>
        </div>
        <div className="brew-section-body">
          <div className="brew-profile-label">Preset</div>
          <div className="brew-profile-dropdowns">
            <select
              className="brew-profile-select"
              value={activeProfile}
              onChange={e => applyProfile(e.target.value, reset)}
            >
              {PROFILES.map(([id, label]) => (
                <option key={id} value={id}>{label}</option>
              ))}
            </select>
          </div>
          <p className="brew-profile-hint">
            Presets fill the roster; use <strong>Custom</strong> and click agents to pick individually.
          </p>
        </div>
      </div>
    </>
  );
}
