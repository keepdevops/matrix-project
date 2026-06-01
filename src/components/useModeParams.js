import { useState } from 'react';

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
          generator: a, scorer: b,
          depth: totDepth, branching: totBranching, prune_below: totPruneBelow,
        },
      };
    }
    return {};
  };

  return {
    chunkCount, setChunkCount,
    roleA, setRoleA,
    roleB, setRoleB,
    maxRounds, setMaxRounds,
    totDepth, setTotDepth,
    totBranching, setTotBranching,
    totPruneBelow, setTotPruneBelow,
    buildModeOpts,
  };
}
