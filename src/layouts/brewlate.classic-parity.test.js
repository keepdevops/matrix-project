/**
 * Static parity: Brewlate vs Matrix Classic (DefaultLayout).
 * Same App layoutProps + equivalent runtime features (different shell/markup).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function layoutPropKeys(_appSrc) {
  // useMemo was extracted to hooks/useAppLayoutProps.js in MS-41
  const hookSrc = read('hooks/useAppLayoutProps.js');
  const block = hookSrc.match(/return useMemo\(\(\) => \(\{([\s\S]*?)\}\), \[/);
  if (!block) throw new Error('layoutProps useMemo block not found in hooks/useAppLayoutProps.js');
  return [...block[1].matchAll(/^\s+(\w+)[,:]/gm)].map(m => m[1]).filter(Boolean);
}

function layoutParams(src, exportName) {
  const re = new RegExp(`export default function ${exportName}\\(\\{([\\s\\S]*?)\\}\\) \\{`);
  const block = src.match(re);
  if (!block) throw new Error(`${exportName} params not found`);
  const names = [...block[1].matchAll(/(\w+)(?=\s*[,=])/g)].map(m => m[1]);
  if (block[1].includes('layout:')) names.push('layout');
  return names;
}

const HANDLERS = [
  'onSubmit', 'onModeChange', 'onClearCache', 'onToggleHistory',
  'onOpenConverter', 'onOpenRagAdmin', 'onOpenCachePanel', 'onOpenHelp',
  'onHistorySelect', 'onFollowUp', 'onClearSession', 'onSwitchSession',
  'onSaveCode', 'onPickFlatAgent', 'onSendBestContinue', 'onUseRagChange',
  'onQualityPass', 'onDeployed', 'onSetTheme', 'onSetLayout',
];

/** Feature → [classic file patterns, brewlate file patterns] */
const FEATURE_PARITY = [
  {
    id: 'agent-prompt-api',
    label: 'Agent prompt edit → PUT /api/agents/.../prompt',
    classic: ['components/SwarmConfig.js', 'components/AgentPromptModal.js'],
    brewlate: ['layouts/BrewlateLayout.js', 'components/AgentPromptModal.js'],
    classicMatch: [/AgentPromptModal/, /setAgentSystemPrompt/],
    brewlateMatch: [/AgentPromptModal/, /setAgentSystemPrompt/],
  },
  {
    id: 'save-code',
    label: 'SAVE CODE on programmer output',
    classic: ['layouts/DefaultLayout.js', 'components/AgentGrid.js', 'components/CodeOutputPanel.js'],
    brewlate: ['layouts/BrewlateLayout.js', 'layouts/BrewAgentGrid.js', 'layouts/BrewCodeResultsPanel.js', 'components/CodeOutputPanel.js'],
    classicMatch: [/onSaveCode/, /SAVE CODE/, /onExpandProgrammer/],
    brewlateMatch: [/onSaveCode=\{onSaveCode\}/, /SAVE CODE/, /useLiveCodeExtraction/, /extractAllCodeBlocks/],
  },
  {
    id: 'kv-gauge-header',
    label: 'KV pressure gauge in header',
    classic: ['components/AppHeader.js'],
    brewlate: ['layouts/BrewHeader.js'],
    classicMatch: [/KvPressureGauge/],
    brewlateMatch: [/KvPressureGauge/, /kvReadings/],
  },
  {
    id: 'pressure-cluster',
    label: 'MLX port pressure cluster',
    classic: ['layouts/DefaultLayout.js', 'components/PressureCluster.js'],
    brewlate: ['layouts/BrewMonitorPopout.js', 'components/PressureCluster.js'],
    classicMatch: [/PressureCluster/],
    brewlateMatch: [/PressureCluster/, /Port Pressure/],
  },
  {
    id: 'pipeline-metrics',
    label: 'Pipeline stages + agent metrics',
    classic: ['layouts/DefaultLayout.js', 'layouts/DefaultLayoutMain.js'],
    brewlate: ['layouts/BrewSessionTab.js', 'layouts/BrewBroadcastTab.js'],
    classicMatch: [/PipelineStageOutputs/, /MetricsStrip/],
    brewlateMatch: [/PipelineStageOutputs/, /MetricsStrip/],
  },
  {
    id: 'token-budgets',
    label: 'Token budgets in configure/agents UI',
    classic: ['components/SwarmAgentSelector.js'],
    brewlate: ['layouts/BrewAgentsPopout.js'],
    classicMatch: [/TokenBudgetPanel/],
    brewlateMatch: [/TokenBudgetPanel/, /brew-agents-popout/],
  },
  {
    id: 'mode-roster',
    label: 'Per-mode roster + presets',
    classic: ['components/ServerLayoutPreview.js'],
    brewlate: ['layouts/BrewPreviewPanel.js', 'layouts/BrewRightPanel.js'],
    classicMatch: [/ModeRosterPanel/, /PresetsPanel/],
    brewlateMatch: [/ModeRosterPanel/, /PresetsPanel/],
  },
  {
    id: 'flat-compare',
    label: 'Flat mode variant compare',
    classic: ['layouts/DefaultLayout.js', 'layouts/DefaultLayoutMain.js'],
    brewlate: ['layouts/BrewAgentsTab.js'],
    classicMatch: [/CompareVariantsPanel/, /activeMode === 'flat'/],
    brewlateMatch: [/CompareVariantsPanel/, /activeMode === 'flat'/],
  },
  {
    id: 'rag-sources',
    label: 'RAG sources after dispatch',
    classic: ['layouts/DefaultLayout.js', 'layouts/DefaultLayoutMain.js'],
    brewlate: ['layouts/BrewSessionTab.js'],
    classicMatch: [/RagSources rag=\{lastMeta/],
    brewlateMatch: [/RagSources rag=\{lastMeta/],
  },
];

const BREWLATE_ONLY_OPTIONAL = new Set([
  'showConfig', 'showConfigPanel', 'deployPending', 'onToggleConfig',
]);

/** App passes these; classic ignores (brewlate wires them). */
const CLASSIC_UNUSED = new Set([
  'agentErrors', 'warningsByMode', 'onCloseHelp', 'onCloseRagAdmin', 'onCloseCachePanel',
  'hostMemory',
  // DefaultLayout constructs its own onExpandProgrammer from onSubmit rather than accepting it as a prop.
  'onExpandProgrammer',
]);

describe('Brewlate vs classic parity', () => {
  const appSrc = read('App.js');
  const classicSrc = read('layouts/DefaultLayout.js');
  const brewShellSrc = read('layouts/BrewlateLayout.js');
  // brewSrc concatenates shell + all sub-components so handler/component checks still pass.
  const brewSrc = brewShellSrc + [
    'layouts/useBrewConfig.js', 'layouts/BrewConfigPanel.js', 'layouts/BrewConfigAgentsSection.js',
    'layouts/BrewRightPanel.js',
    'layouts/BrewPreviewPanel.js', 'layouts/BrewOverlays.js', 'layouts/BrewHistoryDropdown.js',
    'layouts/BrewSessionTab.js', 'layouts/BrewAgentsTab.js', 'layouts/BrewBroadcastTab.js',
    'layouts/BrewRagTab.js',
  ].map(f => read(f)).join('\n');
  const layoutKeys = layoutPropKeys(appSrc);
  const classicParams = new Set(layoutParams(classicSrc, 'DefaultLayout'));
  const brewParams = new Set(layoutParams(brewShellSrc, 'BrewlateLayout'));

  it('both layouts accept the same App layoutProps (except documented Brewlate-only gaps)', () => {
    const missingClassic = layoutKeys.filter(
      k => !classicParams.has(k) && !CLASSIC_UNUSED.has(k) && !BREWLATE_ONLY_OPTIONAL.has(k),
    );
    const missingBrew = layoutKeys.filter(k => !brewParams.has(k) && !BREWLATE_ONLY_OPTIONAL.has(k));
    expect(missingClassic).toEqual([]);
    expect(missingBrew).toEqual([]);
  });

  it.each(HANDLERS)('classic references handler %s', (h) => {
    expect(classicSrc).toMatch(new RegExp(h));
  });

  it.each(HANDLERS)('brewlate references handler %s', (h) => {
    expect(brewSrc).toMatch(new RegExp(h));
  });

  describe.each(FEATURE_PARITY)('$id', ({ label, classic, brewlate, classicMatch, brewlateMatch }) => {
    it(`${label} — classic`, () => {
      const text = classic.map(f => read(f)).join('\n');
      classicMatch.forEach(re => expect(text).toMatch(re));
    });

    it(`${label} — brewlate`, () => {
      const text = brewlate.map(f => read(f)).join('\n');
      brewlateMatch.forEach(re => expect(text).toMatch(re));
    });
  });

  it('classic uses SwarmConfig deploy; brewlate uses inline configure + Brew', () => {
    expect(classicSrc).toMatch(/SwarmConfig/);
    expect(brewSrc).toMatch(/useDeploy/);
    expect(brewSrc).toMatch(/brew-launch-btn/);
  });

  it('registry maps classic → DefaultLayout and brewlate → BrewlateLayout', () => {
    const reg = read('layouts/registry.js');
    expect(reg).toMatch(/classic:\s*\{[^}]*component:\s*DefaultLayout/);
    expect(reg).toMatch(/brewlate:\s*\{[^}]*component:\s*BrewlateLayout/);
  });
});
