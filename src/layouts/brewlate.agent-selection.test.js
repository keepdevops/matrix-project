/**
 * Brewlatte agent selection — wiring + roster logic used by configure panel.
 */
const fs = require('fs');
const path = require('path');
const {
  PROFILE_CUSTOM,
  PROFILE_SAFE,
  PROFILE_MAX,
  getProfileRoles,
  chooseModelForRole,
  computeLayout,
} = require('../components/SwarmConfig.helpers');

const ROOT = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

const ALL_ROLES = [
  'architect', 'foreman', 'programmer', 'specialist', 'security',
  'api', 'database', 'frontend', 'reviewer', 'tester',
  'optimizer', 'debugger', 'devops', 'scout', 'synthesis', 'documenter',
];

describe('Brewlatte agent selection', () => {
  const brewSrc = read('layouts/BrewlateLayout.js') + [
    'layouts/useBrewConfig.js', 'layouts/useBrewRoleHandlers.js', 'layouts/BrewConfigPanel.js', 'layouts/BrewConfigAgentsSection.js',
    'layouts/BrewRightPanel.js',
    'layouts/BrewPreviewPanel.js', 'layouts/BrewOverlays.js', 'layouts/BrewHistoryDropdown.js',
    'layouts/BrewSessionTab.js', 'layouts/BrewAgentsTab.js', 'layouts/BrewBroadcastTab.js',
    'layouts/BrewRagTab.js',
  ].map(f => read(f)).join('\n');
  const cardSrc = read('layouts/BrewAgentCard.js');

  it('exports Custom profile and wires individual selection controls', () => {
    expect(PROFILE_CUSTOM).toBe('custom');
    expect(brewSrc).toMatch(/PROFILE_CUSTOM/);
    expect(brewSrc).toMatch(/selectAllRoles/);
    expect(brewSrc).toMatch(/clearAllRoles/);
    expect(brewSrc).toMatch(/toggleRole/);
    expect(brewSrc).toMatch(/profileId === PROFILE_CUSTOM/);
    expect(brewSrc).toMatch(/showCheckbox/);
    expect(brewSrc).toMatch(/brew-agents-bulk-btn/);
    expect(cardSrc).toMatch(/brew-agent-card-check/);
  });

  it('Custom profile apply is a no-op on roster (does not call setSelected in branch)', () => {
    const customBranch = brewSrc.match(
      /if \(profileId === PROFILE_CUSTOM\) \{([\s\S]*?)\n    \}/,
    );
    expect(customBranch).not.toBeNull();
    expect(customBranch[1]).not.toMatch(/setSelected\(new Set\(picked\)\)/);
    expect(customBranch[1]).toMatch(/setActiveProfile\(PROFILE_CUSTOM\)/);
  });

  it('Safe preset selects fewer agents than Max when many roles exceed safe context cap', () => {
    // safe=1024, max=4096 — use 512/2048/8192 to span all three bands
    const ctxMap = Object.fromEntries(
      ALL_ROLES.map((n, i) => [n, i < 4 ? 512 : i < 12 ? 2048 : 8192]),
    );
    const safe = getProfileRoles(PROFILE_SAFE, ALL_ROLES, ctxMap, {});
    const max  = getProfileRoles(PROFILE_MAX,  ALL_ROLES, ctxMap, {});
    expect(safe.length).toBe(4);          // only 512-ctx agents pass safe=1024
    expect(max.length).toBe(12);          // 512+2048 pass max=4096; 8192 excluded
    expect(safe.length).toBeLessThan(max.length);
  });

  it('toggle-on path auto-assigns a model via chooseModelForRole', () => {
    const models = [
      { path: '/m/3b.gguf', name: '3b', backend: 'llama' },
      { path: '/m/22b.gguf', name: '22b', backend: 'llama' },
    ];
    const path = chooseModelForRole('programmer', models);
    expect(path).toBe('/m/22b.gguf');
    const selected = new Set(['programmer']);
    const roleModels = { programmer: path };
    const roles = [{ name: 'programmer', backend: 'llama' }];
    const layout = computeLayout(roles, selected, roleModels, models);
    expect(layout).toHaveLength(1);
    expect(layout[0].agents).toEqual(['programmer']);
  });

  it('partial selection produces smaller layout than full roster', () => {
    const models = [
      { path: '/m/a.gguf', name: 'a', backend: 'llama' },
      { path: '/m/b.gguf', name: 'b', backend: 'llama' },
    ];
    const roles = [
      { name: 'architect', backend: 'llama' },
      { name: 'programmer', backend: 'llama' },
    ];
    const roleModels = { architect: '/m/a.gguf', programmer: '/m/b.gguf' };
    const one = computeLayout(roles, new Set(['architect']), roleModels, models);
    const two = computeLayout(roles, new Set(['architect', 'programmer']), roleModels, models);
    const countAgents = groups => groups.reduce((n, g) => n + g.agents.length, 0);
    expect(countAgents(one)).toBe(1);
    expect(countAgents(two)).toBe(2);
  });
});
