/** MS-24-8: orchestration mode manifest (backend + UI + memory tier). */
export const MODE_MANIFEST = {
  flat: { backend: 'cpp', enabled: true, ui: true, memoryWeight: 1 },
  pipeline: { backend: 'cpp', enabled: true, ui: true, memoryWeight: 2 },
  cascade: { backend: 'cpp', enabled: true, ui: true, memoryWeight: 2 },
  router: { backend: 'cpp', enabled: true, ui: true, memoryWeight: 1.5 },
  map_reduce: {
    backend: 'python', enabled: true, ui: true, memoryWeight: 3,
    note: 'Splits prompt into chunks, maps across agents, synthesizes findings',
  },
  speculative: {
    backend: 'python', enabled: false, ui: false, memoryWeight: 2,
    note: 'Python orchestration plugin',
  },
  critic_debate: {
    backend: 'python', enabled: false, ui: false, memoryWeight: 2,
    note: 'Python orchestration plugin',
  },
  tree_of_thought: {
    backend: 'python', enabled: false, ui: false, memoryWeight: 3,
    note: 'Python orchestration plugin',
  },
};
