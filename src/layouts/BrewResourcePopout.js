import React from 'react';
import { riskBandId, riskBandLabel } from '../components/SwarmConfig.risk';

const RAM_BUDGET_GB = 36;

export default function BrewResourcePopout({
  riskEstimate,
  roles,
  selected,
}) {
  const usedGB    = riskEstimate?.totalScore ?? 0;
  const fillPct   = Math.min(100, (usedGB / RAM_BUDGET_GB) * 100);
  const band      = riskBandId(riskEstimate?.band);

  const totalSlots = roles.length;
  const usedSlots  = selected.size;
  const freeSlots  = totalSlots - usedSlots;

  const barColor = band === 'high' ? '#e06040'
                 : band === 'medium' ? '#c8a050'
                 : 'var(--brew-accent)';

  return (
    <div className="brew-resource-card">
      <div className="brew-resource-section brew-resource-section--memory">
        <div className="brew-res-mem-header">
          <span className="brew-res-mem-title">Memory Estimate</span>
          <span className="brew-res-mem-value">{usedGB.toFixed(1)} GB</span>
        </div>
        <div className="brew-res-bar-track">
          <div className="brew-res-bar-fill" style={{ width: `${fillPct}%`, background: barColor }} />
        </div>
        <div className="brew-res-bar-cap">{RAM_BUDGET_GB} GB</div>
        {riskEstimate?.band && (
          <div className="brew-res-risk-label">
            Risk: {riskBandLabel(riskEstimate.band)}
          </div>
        )}
      </div>

      <div className="brew-resource-section brew-resource-section--last">
        <div className="brew-res-layout-title">Server Layout</div>
        <div className="brew-res-layout-cols">
          <div className="brew-res-layout-col">
            <span className="brew-res-layout-label">Total</span>
            <span className="brew-res-layout-num">{totalSlots}</span>
          </div>
          <div className="brew-res-layout-col">
            <span className="brew-res-layout-label">Used</span>
            <span className="brew-res-layout-num">{usedSlots}</span>
          </div>
          <div className="brew-res-layout-col">
            <span className="brew-res-layout-label">Available</span>
            <span className="brew-res-layout-num">{freeSlots}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
