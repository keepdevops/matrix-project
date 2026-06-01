import React from 'react';
import ModeParamTotControls from './ModeParamTotControls';
export { useModeParams } from './useModeParams';

function ModeParamControls({
  activeMode, activeAgents = [], loading = false, disabled = false,
  chunkCount, setChunkCount,
  roleA, setRoleA, roleB, setRoleB,
  maxRounds, setMaxRounds,
  totDepth, setTotDepth, totBranching, setTotBranching,
  totPruneBelow, setTotPruneBelow,
}) {
  const roleModes = ['speculative', 'critic_debate', 'tree_of_thought'];
  const showRoles = roleModes.includes(activeMode) && activeAgents.length >= 2;
  const names = activeAgents.map(a => a.name || a);
  const isTot = activeMode === 'tree_of_thought';
  const labelA = activeMode === 'speculative' ? 'Drafter' : 'Generator';
  const labelB = activeMode === 'speculative' ? 'Verifier' : isTot ? 'Scorer' : 'Critic';

  return (
    <>
      {activeMode === 'map_reduce' && (
        <div className="temperature-control">
          <label htmlFor="chunk-count">
            Chunks: <span className="temp-value">{chunkCount}</span>
          </label>
          <input type="range" id="chunk-count" min="2" max="8" step="1" value={chunkCount}
            onChange={(e) => setChunkCount(Number(e.target.value))}
            disabled={loading || disabled} className="temperature-slider" />
        </div>
      )}
      {showRoles && (
        <>
          <div className="temperature-control" style={{ gap: '0.5rem' }}>
            <label>{labelA}:
              <select value={roleA || names[0]} onChange={(e) => setRoleA(e.target.value)}
                disabled={loading || disabled}
                style={{ marginLeft: '0.3rem', fontFamily: 'inherit', fontSize: '0.75rem' }}>
                {names.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <label style={{ marginLeft: '0.75rem' }}>{labelB}:
              <select value={roleB || names[names.length - 1]} onChange={(e) => setRoleB(e.target.value)}
                disabled={loading || disabled}
                style={{ marginLeft: '0.3rem', fontFamily: 'inherit', fontSize: '0.75rem' }}>
                {names.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            {activeMode === 'critic_debate' && (
              <label style={{ marginLeft: '0.75rem' }}>
                Rounds: <span className="temp-value">{maxRounds}</span>
                <input type="range" min="1" max="5" step="1" value={maxRounds}
                  onChange={(e) => setMaxRounds(Number(e.target.value))}
                  disabled={loading || disabled} className="temperature-slider" style={{ width: '4rem' }} />
              </label>
            )}
          </div>
          {isTot && (
            <ModeParamTotControls
              totDepth={totDepth} setTotDepth={setTotDepth}
              totBranching={totBranching} setTotBranching={setTotBranching}
              totPruneBelow={totPruneBelow} setTotPruneBelow={setTotPruneBelow}
              loading={loading} disabled={disabled}
            />
          )}
        </>
      )}
    </>
  );
}

export default React.memo(ModeParamControls);
