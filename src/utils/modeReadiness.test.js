/**
 * modeReadiness tests.
 *
 * Covers:
 * - ok: no warnings when synthesizer and all agents are deployed
 * - cascade/pipeline: warns when synthesizer is configured but not live
 * - cascade/pipeline: no warning when no synthesizer configured
 * - flat/router: no synthesizer warning regardless of config
 * - agents: warns when all configured agents are offline
 * - agents: warns with count when some configured agents are offline
 * - agents: no warning when agents list is empty (uses full roster)
 * - null/undefined inputs: never throws
 */
import { computeModeReadiness } from './modeReadiness';

const LIVE = new Set(['architect', 'programmer', 'reviewer', 'synthesis', 'scout']);

// ---------------------------------------------------------------------------
// ok paths
// ---------------------------------------------------------------------------

test('returns ok=true with no warnings when everything is deployed', () => {
  const cfg = { synthesizer: 'synthesis', agents: ['architect', 'programmer'] };
  const result = computeModeReadiness('cascade', cfg, LIVE);
  expect(result.ok).toBe(true);
  expect(result.warnings).toHaveLength(0);
});

test('returns ok=true when no synthesizer configured (cascade)', () => {
  const cfg = { synthesizer: null, agents: [] };
  const result = computeModeReadiness('cascade', cfg, LIVE);
  expect(result.ok).toBe(true);
  expect(result.warnings).toHaveLength(0);
});

test('returns ok=true for flat mode regardless of roster', () => {
  const cfg = { synthesizer: 'synthesis', agents: ['architect'] };
  const result = computeModeReadiness('flat', cfg, LIVE);
  expect(result.ok).toBe(true);
  expect(result.warnings).toHaveLength(0);
});

test('returns ok=true for router mode with synthesizer configured', () => {
  // router does not require a synthesizer — even if configured, no warning fires
  // agents are all in LIVE so no roster warning either
  const cfg = { synthesizer: 'synthesis', agents: ['architect', 'programmer'] };
  const result = computeModeReadiness('router', cfg, LIVE);
  expect(result.ok).toBe(true);
  expect(result.warnings).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// Synthesizer missing warnings
// ---------------------------------------------------------------------------

test('cascade: warns when synthesizer not in live agents', () => {
  const cfg = { synthesizer: 'synthesis', agents: [] };
  const result = computeModeReadiness('cascade', cfg, new Set(['architect']));
  expect(result.ok).toBe(false);
  expect(result.warnings[0]).toMatch(/synthesizer "synthesis" not deployed/);
  expect(result.warnings[0]).toMatch(/cascade/);
});

test('pipeline: warns when synthesizer not in live agents', () => {
  const cfg = { synthesizer: 'synthesis', agents: [] };
  const result = computeModeReadiness('pipeline', cfg, new Set(['programmer']));
  expect(result.ok).toBe(false);
  expect(result.warnings[0]).toMatch(/synthesizer "synthesis" not deployed/);
  expect(result.warnings[0]).toMatch(/pipeline/);
});

test('flat: no synthesizer warning even when synthesizer not deployed', () => {
  const cfg = { synthesizer: 'synthesis', agents: [] };
  const result = computeModeReadiness('flat', cfg, new Set(['architect']));
  const synthWarnings = result.warnings.filter(w => w.includes('synthesizer'));
  expect(synthWarnings).toHaveLength(0);
});

test('router: no synthesizer warning even when synthesizer not deployed', () => {
  const cfg = { synthesizer: 'synthesis', agents: [] };
  const result = computeModeReadiness('router', cfg, new Set(['foreman']));
  const synthWarnings = result.warnings.filter(w => w.includes('synthesizer'));
  expect(synthWarnings).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// Agent roster warnings
// ---------------------------------------------------------------------------

test('warns when all configured agents are offline', () => {
  const cfg = { synthesizer: null, agents: ['architect', 'programmer'] };
  const result = computeModeReadiness('cascade', cfg, new Set(['reviewer']));
  expect(result.ok).toBe(false);
  expect(result.warnings.some(w => w.includes('all configured agents'))).toBe(true);
});

test('warns with count when some configured agents are offline', () => {
  const cfg = { synthesizer: null, agents: ['architect', 'programmer', 'reviewer'] };
  const result = computeModeReadiness('cascade', cfg, new Set(['architect']));
  expect(result.ok).toBe(false);
  const w = result.warnings.find(w => w.includes('of 3 configured agents offline'));
  expect(w).toBeDefined();
  expect(w).toMatch(/programmer/);
  expect(w).toMatch(/reviewer/);
});

test('no roster warning when agents list is empty (full-roster mode)', () => {
  const cfg = { synthesizer: null, agents: [] };
  const result = computeModeReadiness('flat', cfg, new Set(['architect']));
  const rosterWarnings = result.warnings.filter(w => w.includes('agents'));
  expect(rosterWarnings).toHaveLength(0);
});

test('no roster warning when all configured agents are live', () => {
  const cfg = { synthesizer: null, agents: ['architect', 'programmer'] };
  const result = computeModeReadiness('flat', cfg, LIVE);
  expect(result.warnings.filter(w => w.includes('offline'))).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// Multiple warnings can coexist
// ---------------------------------------------------------------------------

test('both synthesizer and roster warnings fire simultaneously', () => {
  const cfg = { synthesizer: 'synthesis', agents: ['architect', 'programmer'] };
  // synthesis not live, architect not live, programmer not live
  const result = computeModeReadiness('cascade', cfg, new Set(['reviewer']));
  expect(result.ok).toBe(false);
  expect(result.warnings.length).toBeGreaterThanOrEqual(2);
  expect(result.warnings.some(w => w.includes('synthesizer'))).toBe(true);
  expect(result.warnings.some(w => w.includes('offline'))).toBe(true);
});

// ---------------------------------------------------------------------------
// Null / undefined safety
// ---------------------------------------------------------------------------

test('returns ok=true without throwing when activeMode is null', () => {
  expect(() => computeModeReadiness(null, {}, new Set())).not.toThrow();
  expect(computeModeReadiness(null, {}, new Set()).ok).toBe(true);
});

test('returns ok=true without throwing when modeConfig is null', () => {
  expect(() => computeModeReadiness('cascade', null, new Set())).not.toThrow();
  expect(computeModeReadiness('cascade', null, new Set()).ok).toBe(true);
});

test('returns ok=true without throwing when liveAgentNames is null', () => {
  const cfg = { synthesizer: null, agents: [] };
  expect(() => computeModeReadiness('cascade', cfg, null)).not.toThrow();
});

test('handles liveAgentNames as an array (not a Set)', () => {
  const cfg = { synthesizer: 'synthesis', agents: [] };
  const result = computeModeReadiness('cascade', cfg, ['synthesis', 'architect']);
  expect(result.ok).toBe(true);
});

// ---------------------------------------------------------------------------
// Stress: never throws on random inputs
// ---------------------------------------------------------------------------

test('stress: 100 random inputs never throw', () => {
  const modes = ['flat', 'pipeline', 'cascade', 'router', 'unknown', null];
  const agents = ['a', 'b', 'c', 'd', 'e'];
  for (let i = 0; i < 100; i++) {
    const mode = modes[Math.floor(Math.random() * modes.length)];
    const synth = Math.random() > 0.5 ? agents[Math.floor(Math.random() * agents.length)] : null;
    const configured = agents.filter(() => Math.random() > 0.5);
    const live = new Set(agents.filter(() => Math.random() > 0.5));
    const cfg = { synthesizer: synth, agents: configured };
    expect(() => computeModeReadiness(mode, cfg, live)).not.toThrow();
    const { ok, warnings } = computeModeReadiness(mode, cfg, live);
    expect(typeof ok).toBe('boolean');
    expect(Array.isArray(warnings)).toBe(true);
  }
});
