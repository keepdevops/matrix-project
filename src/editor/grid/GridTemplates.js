export const GRID_TEMPLATES = {
  sidebar: {
    label: 'Sidebar',
    areas: [
      ['nav',    'main',    'agents'],
      ['nav',    'main',    'agents'],
      ['nav',    'prompt',  'agents'],
    ],
    rows: ['1fr', '1fr', 'auto'],
    cols: ['200px', '1fr', '260px'],
  },
  wide: {
    label: 'Wide',
    areas: [
      ['prompt',  'prompt',  'config'],
      ['main',    'main',    'agents'],
      ['metrics', 'final',   'agents'],
    ],
    rows: ['auto', '1fr', 'auto'],
    cols: ['1fr', '1fr', '280px'],
  },
  minimal: {
    label: 'Minimal',
    areas: [
      ['main'],
      ['prompt'],
    ],
    rows: ['1fr', 'auto'],
    cols: ['1fr'],
  },
  dashboard: {
    label: 'Dashboard',
    areas: [
      ['metrics', 'metrics', 'metrics'],
      ['main',    'final',   'agents'],
      ['prompt',  'prompt',  'config'],
    ],
    rows: ['auto', '1fr', 'auto'],
    cols: ['1fr', '1fr', '280px'],
  },
};
