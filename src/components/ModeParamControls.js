import React, { useState } from 'react';

/** State + submit opts for Python orchestration mode params. */
export function useModeParams() {
  const [chunkCount, setChunkCount] = useState(3);
  const [roleA, setRoleA] = useState('');
  const [roleB, setRoleB] = useState('');
  const [maxRounds, setMaxRounds] = useState(3);
  const [totDepth, setTotDepth] = useState(2);
  const [totBranching, setTotBranching] = useState(3);
  const [totPruneBelow, setTotPruneBelow] = useState(4);

  const buildModeOpts = (activeMode, activeAgents) => {
    const agentNames = activeAgents.map(a => a.name || a);
    const a = roleA || agentNames[0] || '';
    const b = roleB || agentNames[agentNames.length - 1] || agentNames[0] || '';
    if (activeMode === 'map_reduce') return { chunkCount };
    if (activeMode === 'speculative') return { modeParams: { drafter: a, verifier: b } };
    if (activeMode === 'critic_debate') {
      return { modeParams: { generator: a, critic: b, max_rounds: maxRounds } };
    }
    if (activeMode === 'tree_of_thought') {
      return {
        modeParams: {
          generator: a,
          scorer: b,
          depth: totDepth,
          branching: totBranching,
          prune_below: totPruneBelow,
        },
      };
    }
    return {};
  };

  return {
    chunkCount,
    setChunkCount,
    roleA,
    setRoleA,
    roleB,
    setRoleB,
    maxRounds,
    setMaxRounds,
    totDepth,
    setTotDepth,
    totBranching,
    setTotBranching,
    totPruneBelow,
    setTotPruneBelow,
    buildModeOpts,
  };
}

function ModeParamControls({
  activeMode,
  activeAgents = [],
  loading = false,
  disabled = false,
  chunkCount,
  setChunkCount,
  roleA,
  setRoleA,
  roleB,
  setRoleB,
  maxRounds,
  setMaxRounds,
  totDepth,
  setTotDepth,
  totBranching,
  setTotBranching,
  totPruneBelow,
  setTotPruneBelow,
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
          <input
            type="range"
            id="chunk-count"
            min="2"
            max="8"
            step="1"
            value={chunkCount}
            onChange={(e) => setChunkCount(Number(e.target.value))}
            disabled={loading || disabled}
            className="temperature-slider"
          />
        </div>
      )}
      {showRoles && (
        <>
          <div className="temperature-control" style={{ gap: '0.5rem' }}>
            <label>{labelA}:
              <select
                value={roleA || names[0]}
                onChange={(e) => setRoleA(e.target.value)}
                disabled={loading || disabled}
                style={{ marginLeft: '0.3rem', fontFamily: 'inherit', fontSize: '0.75rem' }}
              >
                {names.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <label style={{ marginLeft: '0.75rem' }}>{labelB}:
              <select
                value={roleB || names[names.length - 1]}
                onChange={(e) => setRoleB(e.target.value)}
                disabled={loading || disabled}
                style={{ marginLeft: '0.3rem', fontFamily: 'inherit', fontSize: '0.75rem' }}
              >
                {names.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            {activeMode === 'critic_debate' && (
              <label style={{ marginLeft: '0.75rem' }}>
                Rounds: <span className="temp-value">{maxRounds}</span>
                <input
                  type="range"
                  min="1"
                  max="5"
                  step="1"
                  value={maxRounds}
                  onChange={(e) => setMaxRounds(Number(e.target.value))}
                  disabled={loading || disabled}
                  className="temperature-slider"
                  style={{ width: '4rem' }}
                />
              </label>
            )}
          </div>
          {isTot && (
            <div className="temperature-control" style={{ gap: '0.5rem' }}>
              <label>
                Depth: <span className="temp-value">{totDepth}</span>
                <input
                  type="range"
                  min="1"
                  max="3"
                  step="1"
                  value={totDepth}
                  onChange={(e) => setTotDepth(Number(e.target.value))}
                  disabled={loading || disabled}
                  className="temperature-slider"
                  style={{ width: '4rem' }}
                />
              </label>
              <label style={{ marginLeft: '0.75rem' }}>
                Branches: <span className="temp-value">{totBranching}</span>
                <input
                  type="range"
                  min="2"
                  max="4"
                  step="1"
                  value={totBranching}
                  onChange={(e) => setTotBranching(Number(e.target.value))}
                  disabled={loading || disabled}
                  className="temperature-slider"
                  style={{ width: '4rem' }}
                />
              </label>
              <label style={{ marginLeft: '0.75rem' }}>
                Prune &lt;: <span className="temp-value">{totPruneBelow}</span>
                <input
                  type="range"
                  min="0"
                  max="9"
                  step="1"
                  value={totPruneBelow}
                  onChange={(e) => setTotPruneBelow(Number(e.target.value))}
                  disabled={loading || disabled}
                  className="temperature-slider"
                  style={{ width: '4rem' }}
                />
              </label>
            </div>
          )}
        </>
      )}
    </>
  );
}

export default React.memo(ModeParamControls);
