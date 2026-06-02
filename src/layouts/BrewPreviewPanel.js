import React from 'react';
import ModeRosterPanel from '../components/ModeRosterPanel';
import PresetsPanel from '../components/PresetsPanel';
import VllmPanel from '../components/VllmPanel';

export default function BrewPreviewPanel({ rosterPct, serverLayout, configLines, engine }) {
  return (
    <div className="brew-preview-inner">
      <div>
        <div className="brew-preview-section-title">Server Layout</div>
        <div className="brew-roster-label">Mode Roster</div>
        <div className="brew-roster-bar">
          <div className="brew-roster-fill" style={{ width: `${rosterPct}%` }} />
        </div>
        <div className="brew-layout-table">
          {serverLayout.length === 0 && (
            <div style={{ fontSize: '0.68rem', color: 'var(--brew-text-dim)' }}>Select agents to see layout</div>
          )}
          {serverLayout.map(s => (
            <div key={s.port} className="brew-layout-row">
              <span className="brew-layout-port">:{s.port}</span>
              <span className="brew-layout-para">
                {s.engine === 'mlx' ? '[mlx]' : s.engine === 'vllm' ? '[vllm]' : `×${s.parallel}`}
              </span>
              <span className="brew-layout-model">{s.model?.split('/').pop() || '—'}</span>
              <span className="brew-layout-agents">[{(s.agents || []).join(', ')}]</span>
            </div>
          ))}
        </div>
      </div>
      <div className="brew-code-preview" style={{ flex: '1 1 0' }}>
        <div className="brew-code-block">
          {configLines.map((line, i) => (
            <div key={i}><span className="brew-code-line-num">{i + 1}</span>{line}</div>
          ))}
        </div>
      </div>
      {engine === 'vllm' && (
        <div className="brew-preview-vllm">
          <VllmPanel />
        </div>
      )}
      <div className="brew-preview-roster">
        <ModeRosterPanel />
        <PresetsPanel />
      </div>
    </div>
  );
}
