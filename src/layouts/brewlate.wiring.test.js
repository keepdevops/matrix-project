/**
 * Brewlate wiring audit — ensures App layoutProps handlers/state reach BrewlateLayout.
 */
const fs = require('fs');
const path = require('path');
require('@testing-library/jest-dom');

jest.mock('./registry', () => ({
  LAYOUTS: { brewlate: { label: 'Brewlate', component: () => null } },
  THEMES: { dark: { label: '☾ Dark' } },
}));

jest.mock('./BrewAgentGrid', () => () => null);
jest.mock('../components/AgentPromptModal', () => () => null);
jest.mock('./BrewAgentsPopout', () => () => null);
jest.mock('../components/CodeDisplay', () => () => null);
jest.mock('../components/ConversationThread', () => () => <div data-testid="conversation-thread" />);
jest.mock('../components/ModeRosterPanel', () => () => null);
jest.mock('../components/PresetsPanel', () => () => null);

jest.mock('../api/swarmApi', () => ({
  fetchSwarmConfig: jest.fn().mockRejectedValue(new Error('offline')),
  fetchModels: jest.fn().mockResolvedValue([]),
  fetchAgents: jest.fn().mockResolvedValue([]),
  invalidateModelsCache: jest.fn(),
}));

jest.mock('../components/SwarmConfig.deploy', () => ({
  useDeploy: () => ({
    status: 'idle',
    statusMsg: '',
    agentStatuses: new Map(),
    deploy: jest.fn(),
    reset: jest.fn(),
  }),
}));

jest.mock('../hooks/useRagHealth', () => () => ({ ok: false, loading: false }));

const ROOT = path.join(__dirname, '..');

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

function layoutPropKeys(_appSrc) {
  // useMemo was extracted to hooks/useAppLayoutProps.js in MS-41
  const hookSrc = read('hooks/useAppLayoutProps.js');
  const block = hookSrc.match(/return useMemo\(\(\) => \(\{([\s\S]*?)\}\), \[/);
  if (!block) throw new Error('layoutProps useMemo block not found in hooks/useAppLayoutProps.js');
  return [...block[1].matchAll(/^\s+(\w+)[,:]/gm)].map(m => m[1]).filter(Boolean);
}

function brewlateParamNames(brewSrc) {
  const block = brewSrc.match(/export default function BrewlateLayout\(\{([\s\S]*?)\}\) \{/);
  if (!block) throw new Error('BrewlateLayout params not found');
  const names = [...block[1].matchAll(/(\w+)(?=\s*[,=])/g)].map(m => m[1]);
  if (block[1].includes('layout:')) names.push('layout');
  return names;
}

const OPTIONAL_UNUSED = new Set([
  'showConfig',
  'showConfigPanel',
  'deployPending',
  'onToggleConfig',
]);

describe('Brewlate wiring audit', () => {
  const appSrc = read('App.js');
  const BREW_SUBMODULES = [
    'layouts/useBrewConfig.js', 'layouts/BrewConfigPanel.js', 'layouts/BrewConfigAgentsSection.js',
    'layouts/BrewRightPanel.js',
    'layouts/BrewPreviewPanel.js', 'layouts/BrewOverlays.js', 'layouts/BrewHistoryDropdown.js',
    'layouts/BrewSessionTab.js', 'layouts/BrewAgentsTab.js', 'layouts/BrewBroadcastTab.js',
    'layouts/BrewRagTab.js',
  ];
  const brewSrc = read('layouts/BrewlateLayout.js') + BREW_SUBMODULES.map(f => read(f)).join('\n');
  const headerSrc = read('layouts/BrewHeader.js');
  const keys = layoutPropKeys(appSrc);
  const params = new Set(brewlateParamNames(brewSrc));

  it('App default layout resolves to BrewlateLayout', () => {
    expect(read('hooks/useLayoutPreference.js')).toMatch(/DEFAULT_LAYOUT = 'brewlate'/);
    expect(read('App.js')).toMatch(/LAYOUTS\[layout\]\?\.component \?\? BrewlateLayout/);
  });

  it('BrewlateLayout destructures every layoutProp except documented optional gaps', () => {
    const missing = keys.filter(k => !params.has(k) && !OPTIONAL_UNUSED.has(k));
    expect(missing).toEqual([]);
  });

  const HANDLER_WIRING = [
    'onSubmit',
    'onModeChange',
    'onClearCache',
    'onToggleHistory',
    'onOpenConverter',
    'onOpenRagAdmin',
    'onOpenCachePanel',
    'onOpenHelp',
    'onHistorySelect',
    'onFollowUp',
    'onClearSession',
    'onSwitchSession',
    'onSaveCode',
    'onPickFlatAgent',
    'onSendBestContinue',
    'onUseRagChange',
    'onQualityPass',
    'onDeployed',
    'onSetTheme',
    'onSetLayout',
    'onExpandProgrammer',
  ];

  it.each(HANDLER_WIRING)('%s is referenced in BrewlateLayout', (handler) => {
    expect(brewSrc).toMatch(new RegExp(handler));
  });

  it('right panel no longer has Monitor tab (moved to left resource card)', () => {
    expect(brewSrc).not.toMatch(/rightTab === 'monitor'/);
    expect(brewSrc).not.toMatch(/\['monitor',\s*'Monitor'\]/);
    expect(read('layouts/BrewMonitorPopout.js')).toMatch(/PressureCluster/);
  });

  it('BrewHeader exposes KV gauge and utilities wired from App handlers', () => {
    expect(headerSrc).toMatch(/KvPressureGauge/);
    expect(headerSrc).toMatch(/kvReadings/);
    expect(headerSrc).toMatch(/onOpenConverter/);
    expect(headerSrc).toMatch(/onOpenRagAdmin/);
    expect(headerSrc).toMatch(/onOpenCachePanel/);
    expect(headerSrc).toMatch(/onOpenHelp/);
    expect(headerSrc).toMatch(/onClearCache/);
    expect(headerSrc).toMatch(/onSetLayout/);
    expect(headerSrc).toMatch(/onSetTheme/);
  });

  it('session tab includes RagSources parity with classic layout', () => {
    expect(brewSrc).toMatch(/RagSources rag=\{lastMeta\?\.rag\}/);
  });

  it('session tab surfaces pipeline metrics and save-code like classic', () => {
    expect(brewSrc).toMatch(/PipelineStageOutputs/);
    expect(brewSrc).toMatch(/MetricsStrip/);
    expect(brewSrc).toMatch(/onSaveCode=\{onSaveCode\}/);
    // Agent edit modal surfaced via BrewOverlays → BrewEditRoleModal
    expect(read('layouts/BrewOverlays.js')).toMatch(/BrewEditRoleModal/);
    expect(brewSrc).toMatch(/BrewAgentsPopout/);
    expect(read('layouts/BrewAgentsPopout.js')).toMatch(/TokenBudgetPanel/);
    expect(read('layouts/BrewEditRoleModal.js')).toMatch(/brew-modal-tab/);
  });

  it('all Matrix themes define Brewlate palette overrides', () => {
    const themes = read('layouts/brewlate-themes.css');
    for (const id of [
      'dark', 'light', 'overdrive', 'synthwave', 'cobalt', 'greyscale',
      'cvd-blue-orange', 'cvd-teal-charcoal', 'cvd-amber',
      'cvd-light-blue-orange', 'cvd-light-tritanopia', 'cvd-light-amber',
    ]) {
      expect(themes).toMatch(new RegExp(`\\[data-theme="${id}"\\]`));
    }
  });
});
