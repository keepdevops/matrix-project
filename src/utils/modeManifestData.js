/** MS-24-8: orchestration mode manifest (backend + UI + memory tier). */
export const MODE_MANIFEST = {
  flat: {
    backend: 'cpp', enabled: true, ui: true, memoryWeight: 1,
    description: 'All agents respond in parallel, no synthesis',
  },
  pipeline: {
    backend: 'cpp', enabled: true, ui: true, memoryWeight: 2,
    description: 'Sequential stages: architect → programmer → synthesizer',
  },
  cascade: {
    backend: 'cpp', enabled: true, ui: true, memoryWeight: 2,
    description: 'Architect drafts, programmer refines, synthesizer merges',
  },
  router: {
    backend: 'cpp', enabled: true, ui: true, memoryWeight: 1.5,
    description: 'Classifier picks the best agent for the query',
  },
  map_reduce: {
    backend: 'python', enabled: true, ui: true, memoryWeight: 3,
    description: 'Splits prompt into chunks, maps across agents, synthesizes findings',
    note: 'Splits prompt into chunks, maps across agents, synthesizes findings',
  },
  speculative: {
    backend: 'python', enabled: true, ui: true, memoryWeight: 2,
    description: 'Drafter proposes tokens; verifier confirms or corrects each block',
    note: 'Drafter proposes, verifier confirms; select roles in prompt controls',
  },
  critic_debate: {
    backend: 'python', enabled: true, ui: true, memoryWeight: 2,
    description: 'Generator proposes; critic reviews until SHIP or max rounds',
    note: 'Generator proposes, critic reviews; repeats until SHIP or max rounds',
  },
  tree_of_thought: {
    backend: 'python', enabled: true, ui: true, memoryWeight: 3,
    description: 'Branches K candidates per depth, scores and prunes, returns best path',
    note: 'Generates K branches, scores and prunes, recurses depth levels',
  },
};
