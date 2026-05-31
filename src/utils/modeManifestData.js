/** MS-24-8: orchestration mode manifest (backend + UI visibility). */
export const MODE_MANIFEST = {
  flat: { backend: 'cpp', enabled: true, ui: true },
  pipeline: { backend: 'cpp', enabled: true, ui: true },
  cascade: { backend: 'cpp', enabled: true, ui: true },
  router: { backend: 'cpp', enabled: true, ui: true },
  map_reduce: {
    backend: 'python', enabled: false, ui: false,
    note: 'Python MLX coordinator only — not on C++ plane',
  },
  speculative: {
    backend: 'python', enabled: false, ui: false,
    note: 'Python orchestration plugin',
  },
  critic_debate: {
    backend: 'python', enabled: false, ui: false,
    note: 'Python orchestration plugin',
  },
  tree_of_thought: {
    backend: 'python', enabled: false, ui: false,
    note: 'Python orchestration plugin',
  },
};
