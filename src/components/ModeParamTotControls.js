import React from 'react';

export default function ModeParamTotControls({
  totDepth, setTotDepth, totBranching, setTotBranching,
  totPruneBelow, setTotPruneBelow, loading, disabled,
}) {
  return (
    <div className="temperature-control" style={{ gap: '0.5rem' }}>
      <label>
        Depth: <span className="temp-value">{totDepth}</span>
        <input type="range" min="1" max="3" step="1" value={totDepth}
          onChange={(e) => setTotDepth(Number(e.target.value))}
          disabled={loading || disabled} className="temperature-slider" style={{ width: '4rem' }} />
      </label>
      <label style={{ marginLeft: '0.75rem' }}>
        Branches: <span className="temp-value">{totBranching}</span>
        <input type="range" min="2" max="4" step="1" value={totBranching}
          onChange={(e) => setTotBranching(Number(e.target.value))}
          disabled={loading || disabled} className="temperature-slider" style={{ width: '4rem' }} />
      </label>
      <label style={{ marginLeft: '0.75rem' }}>
        Prune &lt;: <span className="temp-value">{totPruneBelow}</span>
        <input type="range" min="0" max="9" step="1" value={totPruneBelow}
          onChange={(e) => setTotPruneBelow(Number(e.target.value))}
          disabled={loading || disabled} className="temperature-slider" style={{ width: '4rem' }} />
      </label>
    </div>
  );
}
