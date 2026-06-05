/**
 * BL1-8 / BL1-9 — Resilience & a11y.
 * Covers: coordinator offline / retry path, agent crash buildMeta,
 * BrewConfigUnavailable render, circuit breaker, and ARIA audit.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import BrewConfigUnavailable from './BrewConfigUnavailable';

jest.mock('../components/AgentMarkdown', () => ({ __esModule: true, default: ({ text }) => <span>{text}</span> }));
jest.mock('../components/CodeOutputPanel', () => ({ __esModule: true, default: () => null }));

import { buildMeta } from './BrewAgentGridRow';

const fs   = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

const layoutSrc    = read('layouts/BrewlateLayout.js');
const configSrc    = read('layouts/useBrewConfig.js');
const overlaySrc   = read('layouts/BrewOverlays.js');
const agentsSrc    = read('layouts/BrewConfigAgentsSection.js');
const panelSrc     = read('layouts/BrewConfigPanel.js');
const sessionSrc   = read('layouts/BrewSessionTab.js');
const broadcastSrc = read('layouts/BrewBroadcastTab.js');
const headerSrc    = read('layouts/BrewHeader.js');
const cardSrc      = read('layouts/BrewAgentCard.js');
const gridRowSrc   = read('layouts/BrewAgentGridRow.js');
const agentPopout  = read('layouts/BrewAgentPopout.js');

// ── BrewConfigUnavailable — render ───────────────────────────────────────────

describe('BrewConfigUnavailable — coordinator offline UI', () => {
  it('renders CONFIG UNAVAILABLE message', () => {
    render(<BrewConfigUnavailable onRetry={jest.fn()} />);
    expect(screen.getByText('CONFIG UNAVAILABLE')).toBeInTheDocument();
    expect(screen.getByText(/Start the proxy then retry/)).toBeInTheDocument();
  });

  it('renders RETRY button', () => {
    render(<BrewConfigUnavailable onRetry={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'RETRY' })).toBeInTheDocument();
  });

  it('fires onRetry when RETRY clicked', () => {
    const onRetry = jest.fn();
    render(<BrewConfigUnavailable onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: 'RETRY' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

// ── Retry path wiring ────────────────────────────────────────────────────────

describe('Coordinator offline — retry path wiring', () => {
  it('BrewlateLayout renders BrewConfigUnavailable when loadError is truthy', () => {
    expect(layoutSrc).toMatch(/if \(loadError\)/);
    expect(layoutSrc).toMatch(/BrewConfigUnavailable/);
  });

  it('onRetry calls both invalidateModelsCache and increments loadRetries', () => {
    expect(layoutSrc).toMatch(/invalidateModelsCache\(\)/);
    expect(layoutSrc).toMatch(/setLoadRetries\(r => r \+ 1\)/);
  });

  it('useBrewConfig catches fetchSwarmConfig failure and logs it', () => {
    expect(configSrc).toMatch(/console\.error\('useBrewConfig fetchAgents failed:'/);
    expect(configSrc).toMatch(/setLoadError\(e\.message\)/);
  });

  it('useBrewConfig has cancellation guard to prevent state updates after unmount', () => {
    expect(configSrc).toMatch(/let cancelled = false/);
    expect(configSrc).toMatch(/if \(cancelled\) return/);
    expect(configSrc).toMatch(/return \(\) => \{ cancelled = true; \}/);
  });
});

// ── buildMeta — agent crash / state transitions ───────────────────────────────

describe('buildMeta — agent status display', () => {
  const agent = { name: 'programmer', engine: 'llama', backend: 'llama', port: 8080 };

  it('returns "Status: FAILED" when agentError is set', () => {
    expect(buildMeta(agent, null, 'OOM error', false, false, 0)).toBe('Status: FAILED');
  });

  it('returns "Status: BREWING…" when loading with no response yet', () => {
    expect(buildMeta(agent, null, null, true, false, 0)).toBe('Status: BREWING…');
  });

  it('returns timing info when response received with timings', () => {
    const meta = buildMeta(agent, { total_ms: 2400 }, null, false, true, 0);
    expect(meta).toMatch(/2\.4s/);
    expect(meta).toMatch(/LLAMA/);
  });

  it('includes GPU% when gpu_pct is present in timings', () => {
    const meta = buildMeta(agent, { total_ms: 1500, gpu_pct: 72 }, null, false, true, 0);
    expect(meta).toMatch(/GPU 72%/);
  });

  it('includes context info when ctx > 0', () => {
    const meta = buildMeta(agent, { total_ms: 1000 }, null, false, true, 4096);
    expect(meta).toMatch(/Context/);
  });

  it('falls back to engine + port when no response and not loading', () => {
    const meta = buildMeta(agent, null, null, false, false, 0);
    expect(meta).toMatch(/LLAMA/);
    expect(meta).toMatch(/:8080/);
  });

  it('agent error takes priority over loading state', () => {
    const meta = buildMeta(agent, null, 'crash', true, false, 0);
    expect(meta).toBe('Status: FAILED');
  });
});

// ── Agent error display in grid row ──────────────────────────────────────────

describe('BrewAgentGridRow — error display', () => {
  it('renders error response div with error icon class', () => {
    expect(gridRowSrc).toMatch(/brew-agent-response--error/);
    expect(gridRowSrc).toMatch(/brew-agent-response-error-icon/);
  });

  it('renders loading dots when loading with no response', () => {
    expect(gridRowSrc).toMatch(/brew-agent-response--loading/);
    expect(gridRowSrc).toMatch(/brew-agent-response-dot/);
  });

  it('shows popout button on error response', () => {
    expect(gridRowSrc).toMatch(/onPopout\(\{ name, model.*error: err/s);
  });
});

// ── ARIA audit — BL1-9 ───────────────────────────────────────────────────────

describe('ARIA audit — popout triggers', () => {
  it('BUDGETS trigger has aria-expanded', () => {
    expect(agentsSrc).toMatch(/aria-expanded=\{showAgentsPopout\}/);
  });

  it('MONITOR trigger has aria-expanded', () => {
    // Monitor now lives in the Session panel (BrewRightPanel), not Configure.
    const rightSrc = read('layouts/BrewRightPanel.js');
    expect(rightSrc).toMatch(/aria-expanded=\{monitor\.showMonitor\}/);
  });

  it('header utilities menu has aria-expanded and aria-label', () => {
    const menuSrc = read('layouts/BrewHeaderMenu.js');
    expect(menuSrc).toMatch(/aria-expanded=\{showMenu\}/);
    expect(menuSrc).toMatch(/aria-label="Utilities"/);
  });
});

describe('ARIA audit — live regions and roles', () => {
  it('online/offline status pill has role=status and aria-live=polite', () => {
    expect(headerSrc).toMatch(/role="status"/);
    expect(headerSrc).toMatch(/aria-live="polite"/);
  });

  it('circuit breaker banner has role=status', () => {
    expect(sessionSrc).toMatch(/role="status"/);
    expect(sessionSrc).toMatch(/brew-breaker-banner/);
  });
});

describe('ARIA audit — dialogs', () => {
  it('converter dialog has role=dialog and aria-label', () => {
    expect(overlaySrc).toMatch(/role="dialog"/);
    expect(overlaySrc).toMatch(/aria-label="GGUF to MLX converter"/);
  });

  it('converter close button has aria-label', () => {
    expect(overlaySrc).toMatch(/aria-label="Close converter"/);
  });

  it('agent popout has aria-modal and aria-label', () => {
    expect(agentPopout).toMatch(/aria-modal="true"/);
    expect(agentPopout).toMatch(/aria-label=\{`Agent response — \$\{name\}`\}/);
  });

  it('agents popout dialog has role=dialog and aria-label', () => {
    const popoutSrc = read('layouts/BrewAgentsPopout.js');
    expect(popoutSrc).toMatch(/role="dialog"/);
    expect(popoutSrc).toMatch(/aria-label="Agent token budgets"/);
  });
});

describe('ARIA audit — keyboard navigation', () => {
  it('BrewAgentCard is keyboard-operable when onClick present', () => {
    expect(cardSrc).toMatch(/role=\{onClick \? 'button' : undefined\}/);
    expect(cardSrc).toMatch(/tabIndex=\{onClick \? 0 : undefined\}/);
    expect(cardSrc).toMatch(/onKeyDown/);
    expect(cardSrc).toMatch(/e\.key === 'Enter' \|\| e\.key === ' '/);
  });

  it('BrewHistoryDropdown items are keyboard-operable', () => {
    const historySrc = read('layouts/BrewHistoryDropdown.js');
    expect(historySrc).toMatch(/role="button"/);
    expect(historySrc).toMatch(/tabIndex=\{0\}/);
    expect(historySrc).toMatch(/onKeyDown/);
  });

  it('agent popout closes on Escape key', () => {
    expect(agentPopout).toMatch(/e\.key === 'Escape'/);
  });

  it('monitor popout closes on Escape key', () => {
    const monitorSrc = read('layouts/BrewMonitorPopout.js');
    expect(monitorSrc).toMatch(/e\.key === 'Escape'/);
  });
});
