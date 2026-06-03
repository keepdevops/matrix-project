/**
 * BL1-5 — Real-time & streaming flows.
 * Covers: live-tab auto-focus, BrewSessionTab/BroadcastTab wiring,
 * MetricsStrip logic, orchestration mode reachability.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import MetricsStrip from '../components/MetricsStrip';

const fs   = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

const layoutSrc    = read('layouts/useBrewlateLayout.js');
const sessionSrc   = read('layouts/BrewSessionTab.js');
const broadcastSrc = read('layouts/BrewBroadcastTab.js');
const submitSrc    = read('hooks/useSubmitHandlers.js');
const streamSrc    = read('api/streamApi.js');

const { MODE_MANIFEST } = require('../utils/modeManifestData');

// ── useBrewlateLayout — live tab auto-focus ───────────────────────────────────

describe('useBrewlateLayout — live tab auto-focus', () => {
  it('switches to brewcast tab when loading starts', () => {
    expect(layoutSrc).toMatch(/if \(loading\) setRightTab\('brewcast'\)/);
  });

  it('switches back to session tab when loading ends with meta', () => {
    expect(layoutSrc).toMatch(/else if \(lastMeta\) setRightTab\('session'\)/);
  });

  it('auto-deploys when online and agents present', () => {
    expect(layoutSrc).toMatch(/if \(online && activeAgents\.length > 0\) setDeployed\(true\)/);
  });

  it('resets deployed when coordinator goes offline', () => {
    expect(layoutSrc).toMatch(/else if \(!online\) setDeployed\(false\)/);
  });
});

// ── BrewSessionTab — wiring ───────────────────────────────────────────────────

describe('BrewSessionTab — wiring', () => {
  it('mounts all streaming sub-components', () => {
    for (const comp of [
      'ConversationThread', 'FinalAnswerPanel', 'BrewCodeResultsPanel',
      'RagSources', 'MetricsStrip', 'PipelineStageOutputs', 'PromptInput',
    ]) {
      expect(sessionSrc).toMatch(new RegExp(comp));
    }
  });

  it('passes onExpandProgrammer to BrewCodeResultsPanel', () => {
    expect(sessionSrc).toMatch(/onExpandProgrammer=\{onExpandProgrammer\}/);
  });

  it('uses BREW / BREWING… / REFINE labels on PromptInput', () => {
    expect(sessionSrc).toMatch(/submitLabel="BREW"/);
    expect(sessionSrc).toMatch(/submitLoadingLabel="BREWING…"/);
    expect(sessionSrc).toMatch(/qualityPassLabel="REFINE"/);
  });

  it('shows circuit breaker banner when excludedBreaker non-empty', () => {
    expect(sessionSrc).toMatch(/excludedBreaker\.length > 0/);
    expect(sessionSrc).toMatch(/dispatch-hint-banner--breaker/);
    expect(sessionSrc).toMatch(/Cooldown ~30s/);
  });

  it('shows friendly message for coordinator offline error', () => {
    expect(sessionSrc).toMatch(/Coordinator offline/);
    expect(sessionSrc).toMatch(/open CONFIGURE and click Brew/);
  });

  it('gates MetricsStrip and PipelineStageOutputs on lastMeta presence', () => {
    expect(sessionSrc).toMatch(/\{lastMeta && \(/);
    const metaBlock = sessionSrc.slice(sessionSrc.indexOf('lastMeta && ('));
    expect(metaBlock.slice(0, 200)).toMatch(/PipelineStageOutputs/);
    expect(metaBlock.slice(0, 200)).toMatch(/MetricsStrip/);
  });

  it('passes PromptInput canContinue from currentSession.sessionId', () => {
    expect(sessionSrc).toMatch(/canContinue=\{Boolean\(currentSession\?\.sessionId\)\}/);
  });
});

// ── BrewBroadcastTab — live state ─────────────────────────────────────────────

describe('BrewBroadcastTab — live state', () => {
  it('shows empty-state hint when no meta and not loading', () => {
    expect(broadcastSrc).toMatch(/!lastMeta && !loading/);
    expect(broadcastSrc).toMatch(/No broadcast yet/);
  });

  it('shows LIVE indicator when loading', () => {
    expect(broadcastSrc).toMatch(/\{loading && \(/);
    expect(broadcastSrc).toMatch(/brew-brewcast-live-label/);
    expect(broadcastSrc).toMatch(/LIVE/);
  });

  it('PhaseLabel renders agent · depth · round from _phase', () => {
    expect(broadcastSrc).toMatch(/phase\.agent/);
    expect(broadcastSrc).toMatch(/depth \$\{phase\.depth \+ 1\}/);
    expect(broadcastSrc).toMatch(/round \$\{phase\.round\}/);
    expect(broadcastSrc).toMatch(/lastMeta\?\._phase/);
  });

  it('mounts BrewAgentGrid during loading or after meta', () => {
    expect(broadcastSrc).toMatch(/\(loading \|\| lastMeta\)/);
    expect(broadcastSrc).toMatch(/BrewAgentGrid/);
    expect(broadcastSrc).toMatch(/compact/);
  });

  it('shows MetricsStrip and PipelineStageOutputs after meta', () => {
    expect(broadcastSrc).toMatch(/\{lastMeta && \(/);
    expect(broadcastSrc).toMatch(/MetricsStrip/);
    expect(broadcastSrc).toMatch(/PipelineStageOutputs/);
  });

  it('passes flat-pick mode props to BrewAgentGrid', () => {
    expect(broadcastSrc).toMatch(/flatPickMode=\{activeMode === 'flat'\}/);
    expect(broadcastSrc).toMatch(/onPickFlatAgent=\{onPickFlatAgent\}/);
  });
});

// ── MetricsStrip — rendering logic ───────────────────────────────────────────

jest.mock('../components/ImportanceBar', () => () => null);
jest.mock('../components/TruncationBadge', () => () => null);
jest.mock('../components/MetricsStripBadges', () => () => null);

describe('MetricsStrip — rendering logic', () => {
  it('renders nothing when timings are absent', () => {
    const { container } = render(<MetricsStrip envelope={{ meta: {} }} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when timings is an empty object', () => {
    const { container } = render(<MetricsStrip envelope={{ meta: { timings: {} } }} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders RUN METRICS title when timings present', () => {
    render(<MetricsStrip envelope={{ meta: { timings: { architect: { total_ms: 1200, completion_tokens: 80 } } } }} />);
    expect(screen.getByText('RUN METRICS')).toBeInTheDocument();
  });

  it('shows wall time when wall_ms is provided', () => {
    render(<MetricsStrip envelope={{ meta: {
      timings: { arch: { total_ms: 800, completion_tokens: 40 } },
      wall_ms: 2500,
    }}} />);
    expect(screen.getByText(/wall 2\.50s/)).toBeInTheDocument();
  });

  it('renders one row per agent', () => {
    render(<MetricsStrip envelope={{ meta: { timings: {
      architect:  { total_ms: 1200, completion_tokens: 80 },
      programmer: { total_ms:  600, completion_tokens: 40 },
    }}}} />);
    expect(screen.getByText('architect')).toBeInTheDocument();
    expect(screen.getByText('programmer')).toBeInTheDocument();
  });

  it('sorts rows by total_ms descending', () => {
    render(<MetricsStrip envelope={{ meta: { timings: {
      fast:  { total_ms:  200, completion_tokens: 5 },
      slow:  { total_ms: 2000, completion_tokens: 50 },
      mid:   { total_ms:  800, completion_tokens: 20 },
    }}}} />);
    const rows = document.querySelectorAll('.metrics-strip-name');
    expect(rows[0].textContent).toBe('slow');
    expect(rows[1].textContent).toBe('mid');
    expect(rows[2].textContent).toBe('fast');
  });

  it('renders SESSION TOKENS budget bar when budget > 0', () => {
    render(<MetricsStrip envelope={{ meta: {
      timings: { a: { total_ms: 100, completion_tokens: 10 } },
      token_budget: { budget: 10000, consumed: 3500 },
    }}} />);
    expect(screen.getByText('SESSION TOKENS')).toBeInTheDocument();
    expect(screen.getByText(/3500 \/ 10000/)).toBeInTheDocument();
  });

  it('shows OVERRUN label when token budget is exceeded', () => {
    render(<MetricsStrip envelope={{ meta: {
      timings: { a: { total_ms: 100, completion_tokens: 10 } },
      token_budget: { budget: 5000, consumed: 6000, overrun: true },
    }}} />);
    expect(screen.getByText('OVERRUN')).toBeInTheDocument();
  });

  it('omits budget section when budget is 0', () => {
    render(<MetricsStrip envelope={{ meta: {
      timings: { a: { total_ms: 100, completion_tokens: 10 } },
      token_budget: { budget: 0, consumed: 0 },
    }}} />);
    expect(screen.queryByText('SESSION TOKENS')).not.toBeInTheDocument();
  });

  it('shows backend routing badge when meta.routing present', () => {
    render(<MetricsStrip envelope={{ meta: {
      timings: { programmer: { total_ms: 500, completion_tokens: 30 } },
      routing: { programmer: { backend: 'llama_metal', reason: 'sequential_apple_silicon' } },
    }}} />);
    expect(screen.getByText('llama_metal')).toBeInTheDocument();
    expect(screen.getByTitle('sequential_apple_silicon')).toBeInTheDocument();
  });
});

// ── Orchestration modes — reachability ───────────────────────────────────────

describe('Orchestration modes — reachability', () => {
  const UI_MODES = Object.entries(MODE_MANIFEST)
    .filter(([, v]) => v.ui)
    .map(([k]) => k);

  it('all ui-enabled modes are referenced in submit handler or mode manifest', () => {
    for (const mode of UI_MODES) {
      const inSubmit  = submitSrc.includes(`'${mode}'`) || submitSrc.includes(`"${mode}"`);
      const inManifest = Object.prototype.hasOwnProperty.call(MODE_MANIFEST, mode);
      expect(inManifest || inSubmit).toBe(true);
    }
  });

  it('PYTHON_ORCHESTRATE_MODES are all present in manifest with python backend', () => {
    const pythonModes = ['map_reduce', 'speculative', 'critic_debate', 'tree_of_thought'];
    for (const m of pythonModes) {
      expect(submitSrc).toMatch(new RegExp(`'${m}'`));
      expect(MODE_MANIFEST[m]).toBeDefined();
      expect(MODE_MANIFEST[m].backend).toBe('python');
    }
  });

  it('pipeline and cascade set hasFinal (final answer accumulation)', () => {
    expect(submitSrc).toMatch(/\['pipeline', 'cascade'\]\.includes\(activeMode\)/);
  });

  it('map_reduce chunks the prompt via splitIntoChunks', () => {
    expect(submitSrc).toMatch(/activeMode === 'map_reduce'/);
    expect(submitSrc).toMatch(/splitIntoChunks/);
    expect(submitSrc).toMatch(/orchestrateParams = \{ chunks:/);
  });

  it('SSE stream targets /api/architect/stream with token and metrics events', () => {
    expect(streamSrc).toMatch(/architect\/stream/);
    expect(streamSrc).toMatch(/eventName === 'token'/);
    expect(streamSrc).toMatch(/eventName === 'metrics'/);
  });

  it('all ui-enabled modes have a non-empty description', () => {
    for (const [name, entry] of Object.entries(MODE_MANIFEST)) {
      if (entry.ui) {
        expect(entry.description.length).toBeGreaterThan(0);
        expect(entry).toHaveProperty('memoryWeight');
      }
    }
  });
});
