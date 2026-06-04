/**
 * BL1-3 — Panel visibility regression guards.
 *
 * Static source analysis: verifies that components restored in MS-BL1-2 and
 * added in MS-69/70 are mounted at the correct call sites. Each test is a
 * contract: if the relevant import or JSX expression disappears, the test
 * fails before any manual smoke run is needed.
 *
 * No DOM, no runtime — pure fs.readFileSync assertions.
 */
const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

const configPanelSrc    = read('layouts/BrewConfigPanel.js');
const monitorPopoutSrc  = read('layouts/BrewMonitorPopout.js');
const previewPanelSrc   = read('layouts/BrewPreviewPanel.js');
const sessionTabSrc     = read('layouts/BrewSessionTab.js');
const convTurnSrc       = read('components/ConversationTurn.js');
const metricsStripSrc   = read('components/MetricsStrip.js');
const metricsBadgesSrc  = read('components/MetricsStripBadges.js');
const rssPanelSrc       = read('components/RssPanel.js');
const rssApiSrc         = read('api/rssApi.js');

// ── VllmPanel (MS-BL1-2) ────────────────────────────────────────────────────

describe('VllmPanel — visibility contract', () => {
  it('is imported in BrewConfigPanel', () => {
    expect(configPanelSrc).toMatch(/import VllmPanel from ['"]\.\.\/components\/VllmPanel['"]/);
  });

  it('is rendered in BrewConfigPanel when engine === vllm', () => {
    expect(configPanelSrc).toMatch(/engine\s*===\s*['"]vllm['"]\s*&&\s*<VllmPanel/);
  });

  it('is also present pre-deploy in BrewPreviewPanel', () => {
    expect(previewPanelSrc).toMatch(/import VllmPanel/);
    expect(previewPanelSrc).toMatch(/engine\s*===\s*['"]vllm['"]/);
    expect(previewPanelSrc).toMatch(/<VllmPanel/);
  });
});

// ── RssPanel (MS-69 Phase B) ─────────────────────────────────────────────────

describe('RssPanel — visibility contract', () => {
  it('is imported in BrewMonitorPopout', () => {
    expect(monitorPopoutSrc).toMatch(/import RssPanel from ['"]\.\.\/components\/RssPanel['"]/);
  });

  it('is mounted unconditionally in BrewMonitorPopout body', () => {
    expect(monitorPopoutSrc).toMatch(/<RssPanel\s*\/>/);
  });

  it('polls all three RSS categories via rssApi', () => {
    expect(rssApiSrc).toMatch(/['"]history['"]/);
    expect(rssApiSrc).toMatch(/['"]config['"]/);
    expect(rssApiSrc).toMatch(/['"]token-regulation['"]/);
  });

  it('handles disabled coordinator gracefully (returns [])', () => {
    expect(rssApiSrc).toMatch(/return \[\]/);
  });

  it('renders a notice when feed is empty', () => {
    expect(rssPanelSrc).toMatch(/rss-panel-notice/);
    expect(rssPanelSrc).toMatch(/enabled/i);
  });
});

// ── DeployProgress — always visible in configure footer ──────────────────────

describe('DeployProgress — configure footer', () => {
  it('is imported in BrewConfigPanel', () => {
    expect(configPanelSrc).toMatch(/import.*DeployProgress.*from/);
  });

  it('receives status, statusMsg, logTail props', () => {
    expect(configPanelSrc).toMatch(/<DeployProgress\s[^>]*status=/);
    expect(configPanelSrc).toMatch(/statusMsg=/);
    expect(configPanelSrc).toMatch(/logTail=/);
  });
});

// ── TES badge (MS-70) ────────────────────────────────────────────────────────

describe('TES badge — ConversationTurn', () => {
  it('renders ct-tes-badge when entry._meta.tes is present', () => {
    expect(convTurnSrc).toMatch(/ct-tes-badge/);
    expect(convTurnSrc).toMatch(/_meta\?\.tes\s*!=\s*null/);
  });

  it('shows TES value formatted to 2 decimal places', () => {
    expect(convTurnSrc).toMatch(/tes\.toFixed\(2\)/);
  });
});

// ── MetricsStripBadges — observability badges ────────────────────────────────

describe('MetricsStripBadges — context_gate + auto_clear_kv', () => {
  it('shows [CTX] badge when context_gate.triggered is true', () => {
    expect(metricsBadgesSrc).toMatch(/context_gate\?\.triggered/);
  });

  it('shows auto-clear notice when auto_clear_kv is true', () => {
    expect(metricsBadgesSrc).toMatch(/auto_clear_kv/);
  });
});

// ── MetricsStrip — session token budget ──────────────────────────────────────

describe('MetricsStrip — SESSION TOKENS row', () => {
  it('renders budget bar when token_budget.budget > 0', () => {
    expect(metricsStripSrc).toMatch(/tb\.budget\s*>\s*0/);
    expect(metricsStripSrc).toMatch(/metrics-strip-budget/);
  });

  it('surfaces OVERRUN badge when tb.overrun is true', () => {
    expect(metricsStripSrc).toMatch(/tb\.overrun/);
    expect(metricsStripSrc).toMatch(/OVERRUN/);
  });
});

// ── BrewSessionTab — MetricsStrip is mounted ────────────────────────────────

describe('BrewSessionTab — post-dispatch panels', () => {
  it('mounts MetricsStrip with lastMeta envelope', () => {
    expect(sessionTabSrc).toMatch(/import MetricsStrip/);
    expect(sessionTabSrc).toMatch(/<MetricsStrip\s[^>]*envelope=/);
  });

  it('mounts PipelineStageOutputs when lastMeta is present', () => {
    expect(sessionTabSrc).toMatch(/import PipelineStageOutputs/);
    expect(sessionTabSrc).toMatch(/<PipelineStageOutputs/);
  });

  it('mounts RagSources for RAG hit display', () => {
    expect(sessionTabSrc).toMatch(/import RagSources/);
    expect(sessionTabSrc).toMatch(/<RagSources/);
  });
});
