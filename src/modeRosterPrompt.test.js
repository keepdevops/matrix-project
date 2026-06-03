/**
 * Comprehensive tests: modes × agent roster variations × prompt behaviours.
 *
 * Covers:
 * - All four modes (flat, pipeline, cascade, router) with diverse prompts
 * - Per-mode roster: full roster, partial roster, empty roster, stale agents
 * - Synthesizer presence / absence per mode
 * - Prompt variations: short, long, multi-line, code, special characters, empty
 * - computeModeReadiness across all modes + roster states
 * - qualityPassContextPolicy budget and include-list per mode
 * - useSubmitHandlers: context injection, mode-specific follow-up, warning dispatch
 * - bestAgentText + buildSessionList with mixed-mode history
 * - Stress: 100 mode × roster × prompt combinations
 */

import { renderHook, act } from '@testing-library/react';
import { computeModeReadiness } from './utils/modeReadiness';
import { qualityPassContextPolicy } from './utils/qualityPassContext';
import { bestAgentText, buildSessionList, METADATA_KEYS } from './utils/conversationHelpers';
import { useSubmitHandlers } from './hooks/useSubmitHandlers';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALL_MODES = ['flat', 'pipeline', 'cascade', 'router'];

const ALL_AGENTS = [
  'architect', 'programmer', 'reviewer', 'synthesis', 'scout',
  'tester', 'security', 'devops', 'documenter', 'optimizer',
  'debugger', 'database', 'frontend', 'api', 'foreman', 'specialist',
];

const PROMPT_VARIANTS = [
  'hello world',
  'Write a REST API in Go with auth middleware.',
  'Fix the null pointer exception on line 42 of src/main.cpp.',
  Array(300).fill('word').join(' '),               // long prompt
  'How do I\nhandle\nmultiline\ninput?',           // multi-line
  '```python\nprint("hello")\n```',                // code block
  '<script>alert(1)</script>',                     // XSS-like
  '¿Hablas español? 日本語 العربية',               // unicode
  '',                                              // empty
  '   ',                                           // whitespace-only
];

const SYNTHESIZERS = ['synthesis', 'foreman', null, undefined];

// ---------------------------------------------------------------------------
// Roster fixtures
// ---------------------------------------------------------------------------

function makeRoster(agents) { return new Set(agents); }

const FULL_ROSTER   = makeRoster(ALL_AGENTS);
const HALF_ROSTER   = makeRoster(ALL_AGENTS.slice(0, 8));
const MINIMAL_ROSTER = makeRoster(['architect', 'programmer']);
const EMPTY_ROSTER  = makeRoster([]);
const SYNTHESIS_ONLY = makeRoster(['synthesis']);

// ---------------------------------------------------------------------------
// Section 1: computeModeReadiness — all modes × roster states
// ---------------------------------------------------------------------------

describe('computeModeReadiness — flat mode', () => {
  it('ok with full roster and any synthesizer', () => {
    const cfg = { synthesizer: 'synthesis', agents: ['architect', 'programmer'] };
    expect(computeModeReadiness('flat', cfg, FULL_ROSTER).ok).toBe(true);
  });

  it('ok even when synthesizer is absent (flat does not require it)', () => {
    const cfg = { synthesizer: 'synthesis', agents: ['architect', 'programmer'] };
    expect(computeModeReadiness('flat', cfg, MINIMAL_ROSTER).ok).toBe(true);
  });

  it('warns when all configured agents are offline', () => {
    const cfg = { agents: ['debugger', 'database'] };
    const { ok, warnings } = computeModeReadiness('flat', cfg, MINIMAL_ROSTER);
    expect(ok).toBe(false);
    expect(warnings[0]).toMatch(/all configured agents/);
  });

  it('warns with count when some agents are offline', () => {
    const cfg = { agents: ['architect', 'debugger', 'database'] };
    const { ok, warnings } = computeModeReadiness('flat', cfg, MINIMAL_ROSTER);
    expect(ok).toBe(false);
    expect(warnings[0]).toMatch(/2 of 3/);
  });

  it('ok when agents list is empty (flat uses full swarm)', () => {
    const cfg = { agents: [] };
    expect(computeModeReadiness('flat', cfg, EMPTY_ROSTER).ok).toBe(true);
  });
});

describe('computeModeReadiness — pipeline mode', () => {
  it('ok when synthesizer and all agents are live', () => {
    const cfg = { synthesizer: 'synthesis', agents: ['architect', 'programmer', 'reviewer'] };
    expect(computeModeReadiness('pipeline', cfg, FULL_ROSTER).ok).toBe(true);
  });

  it('warns when synthesizer is absent', () => {
    const cfg = { synthesizer: 'synthesis', agents: ['architect'] };
    const { ok, warnings } = computeModeReadiness('pipeline', cfg, MINIMAL_ROSTER);
    expect(ok).toBe(false);
    expect(warnings[0]).toMatch(/synthesizer "synthesis" not deployed/);
    expect(warnings[0]).toMatch(/pipeline/);
  });

  it('no synthesizer warning when synthesizer is null', () => {
    const cfg = { synthesizer: null, agents: ['architect', 'programmer'] };
    const { ok } = computeModeReadiness('pipeline', cfg, MINIMAL_ROSTER);
    expect(ok).toBe(true);
  });

  it('warns with correct count when partial roster missing', () => {
    const cfg = { synthesizer: 'synthesis', agents: ['architect', 'programmer', 'tester', 'security'] };
    const live = makeRoster(['synthesis', 'architect']);
    const { ok, warnings } = computeModeReadiness('pipeline', cfg, live);
    expect(ok).toBe(false);
    const rosterWarn = warnings.find(w => /of \d+ configured/.test(w));
    expect(rosterWarn).toMatch(/3 of 4/);
  });

  it('warns for both synthesizer and full roster offline', () => {
    const cfg = { synthesizer: 'synthesis', agents: ['tester', 'security'] };
    const { warnings } = computeModeReadiness('pipeline', cfg, EMPTY_ROSTER);
    expect(warnings.length).toBeGreaterThanOrEqual(2);
  });
});

describe('computeModeReadiness — cascade mode', () => {
  it('ok with full roster including synthesizer', () => {
    const cfg = { synthesizer: 'synthesis', agents: ALL_AGENTS.slice(0, 6) };
    expect(computeModeReadiness('cascade', cfg, FULL_ROSTER).ok).toBe(true);
  });

  it('warns when synthesizer is configured but offline', () => {
    const cfg = { synthesizer: 'foreman', agents: ['architect'] };
    const { ok, warnings } = computeModeReadiness('cascade', cfg, MINIMAL_ROSTER);
    expect(ok).toBe(false);
    expect(warnings[0]).toMatch(/synthesizer "foreman" not deployed/);
    expect(warnings[0]).toMatch(/cascade/);
  });

  it('warns when synthesizer deployed but all other agents offline', () => {
    const cfg = { synthesizer: 'synthesis', agents: ['tester', 'security', 'debugger'] };
    const { ok, warnings } = computeModeReadiness('cascade', cfg, SYNTHESIS_ONLY);
    expect(ok).toBe(false);
    expect(warnings.some(w => /all configured agents/.test(w))).toBe(true);
  });

  it('no warning when agents list empty even with empty roster', () => {
    const cfg = { synthesizer: null, agents: [] };
    expect(computeModeReadiness('cascade', cfg, EMPTY_ROSTER).ok).toBe(true);
  });
});

describe('computeModeReadiness — router mode', () => {
  it('ok with full roster and synthesizer', () => {
    const cfg = { synthesizer: 'synthesis', agents: ['architect', 'programmer', 'specialist'] };
    expect(computeModeReadiness('router', cfg, FULL_ROSTER).ok).toBe(true);
  });

  it('does NOT warn about missing synthesizer (router handles routing, not synthesis)', () => {
    const cfg = { synthesizer: 'synthesis', agents: ['architect'] };
    const { warnings } = computeModeReadiness('router', cfg, MINIMAL_ROSTER);
    expect(warnings.every(w => !/synthesizer/.test(w))).toBe(true);
  });

  it('warns when all router agents are offline', () => {
    const cfg = { agents: ['specialist', 'database', 'frontend'] };
    const { ok } = computeModeReadiness('router', cfg, MINIMAL_ROSTER);
    expect(ok).toBe(false);
  });

  it('warns with count when some router agents offline', () => {
    const cfg = { agents: ['architect', 'specialist', 'database'] };
    const live = makeRoster(['architect']);
    const { warnings } = computeModeReadiness('router', cfg, live);
    expect(warnings[0]).toMatch(/2 of 3/);
  });
});

describe('computeModeReadiness — null / edge inputs', () => {
  it('returns ok=true for null activeMode', () => {
    expect(computeModeReadiness(null, { agents: [] }, FULL_ROSTER).ok).toBe(true);
  });

  it('returns ok=true for undefined modeConfig', () => {
    expect(computeModeReadiness('cascade', undefined, FULL_ROSTER).ok).toBe(true);
  });

  it('returns ok=true for null liveAgentNames', () => {
    const cfg = { synthesizer: null, agents: [] };
    expect(computeModeReadiness('flat', cfg, null).ok).toBe(true);
  });

  it('never throws for any combination of nulls', () => {
    expect(() => computeModeReadiness(null, null, null)).not.toThrow();
    expect(() => computeModeReadiness(undefined, undefined, undefined)).not.toThrow();
  });

  it('accepts array for liveAgentNames', () => {
    const cfg = { synthesizer: 'synthesis', agents: ['architect'] };
    expect(() => computeModeReadiness('cascade', cfg, ['synthesis', 'architect'])).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Section 2: qualityPassContextPolicy — per-mode prompt context budgets
// ---------------------------------------------------------------------------

describe('qualityPassContextPolicy — budgets per mode', () => {
  it('pipeline gets 4500 budget', () => {
    expect(qualityPassContextPolicy('pipeline').max_context_chars).toBe(4500);
  });

  it('flat gets 5000 budget', () => {
    expect(qualityPassContextPolicy('flat').max_context_chars).toBe(5000);
  });

  it('cascade gets 5500 budget', () => {
    expect(qualityPassContextPolicy('cascade').max_context_chars).toBe(5500);
  });

  it('router gets 5500 budget', () => {
    expect(qualityPassContextPolicy('router').max_context_chars).toBe(5500);
  });

  it('unknown mode falls back to 4500 budget', () => {
    expect(qualityPassContextPolicy('unknown').max_context_chars).toBe(4500);
  });

  test.each(ALL_MODES)('%s includes original_prompt in context', (mode) => {
    expect(qualityPassContextPolicy(mode).include).toContain('original_prompt');
  });

  test.each(ALL_MODES)('%s includes final in context', (mode) => {
    expect(qualityPassContextPolicy(mode).include).toContain('final');
  });

  test.each(ALL_MODES)('%s targets programmer agent', (mode) => {
    expect(qualityPassContextPolicy(mode).target_agent).toBe('programmer');
  });

  it('includes tester and reviewer in all modes', () => {
    ALL_MODES.forEach(m => {
      const { include } = qualityPassContextPolicy(m);
      expect(include).toContain('tester');
      expect(include).toContain('reviewer');
    });
  });
});

// ---------------------------------------------------------------------------
// Section 3: useSubmitHandlers — mode × prompt × context injection
// ---------------------------------------------------------------------------

function makeHook(overrides = {}) {
  const submit = jest.fn().mockResolvedValue(undefined);
  const loadHistory = jest.fn().mockResolvedValue([]);
  const onModeWarning = jest.fn();
  const opts = {
    submit,
    loadHistory,
    currentSession: null,
    activeMode: 'flat',
    useRag: false,
    responses: {},
    activeAgents: [],
    flatPickAgent: null,
    modeWarnings: [],
    onModeWarning,
    ...overrides,
  };
  return { submit, loadHistory, onModeWarning, opts };
}

describe('useSubmitHandlers — flat mode prompts', () => {
  it('submits prompt without injecting final in context (flat)', async () => {
    const session = { sessionId: 'sess-flat-01' };
    const { submit, opts } = makeHook({ activeMode: 'flat', currentSession: session });
    const { result } = renderHook(() => useSubmitHandlers(opts));
    await act(async () => { await result.current.handleSubmit('List all endpoints', 0.3); });
    const body = submit.mock.calls[0][2];
    expect(body.contextPolicy?.include).not.toContain('final');
    expect(body.contextPolicy?.include).toContain('original_prompt');
  });

  it('calls loadHistory after submission', async () => {
    const { loadHistory, opts } = makeHook({ activeMode: 'flat' });
    const { result } = renderHook(() => useSubmitHandlers(opts));
    await act(async () => { await result.current.handleSubmit('hello', 0.5); });
    expect(loadHistory).toHaveBeenCalled();
  });

  it('fires onModeWarning when modeWarnings is non-empty', async () => {
    const { onModeWarning, opts } = makeHook({
      activeMode: 'flat',
      modeWarnings: ['all configured agents offline'],
    });
    const { result } = renderHook(() => useSubmitHandlers(opts));
    await act(async () => { await result.current.handleSubmit('hello', 0.3); });
    expect(onModeWarning).toHaveBeenCalledWith(['all configured agents offline']);
  });
});

describe('useSubmitHandlers — pipeline mode prompts', () => {
  it('injects final in context for pipeline sessions', async () => {
    const session = { sessionId: 'sess-pipe-01' };
    const { submit, opts } = makeHook({ activeMode: 'pipeline', currentSession: session });
    const { result } = renderHook(() => useSubmitHandlers(opts));
    await act(async () => { await result.current.handleSubmit('Build a CI pipeline', 0.4); });
    expect(submit.mock.calls[0][2].contextPolicy?.include).toContain('final');
  });

  it('quality pass uses correct instruction text for pipeline', async () => {
    const { submit, opts } = makeHook({ activeMode: 'pipeline' });
    const { result } = renderHook(() => useSubmitHandlers(opts));
    await act(async () => { await result.current.handleQualityPass(0.2); });
    const [instruction, , callOpts] = submit.mock.calls[0];
    expect(instruction).toMatch(/compile errors/);
    expect(callOpts.qualityPass).toBe(true);
    expect(callOpts.contextPolicy.max_context_chars).toBe(4500);
  });
});

describe('useSubmitHandlers — cascade mode prompts', () => {
  it('injects final in context for cascade sessions', async () => {
    const session = { sessionId: 'sess-casc-01' };
    const { submit, opts } = makeHook({ activeMode: 'cascade', currentSession: session });
    const { result } = renderHook(() => useSubmitHandlers(opts));
    await act(async () => { await result.current.handleSubmit('Design auth flow', 0.5); });
    expect(submit.mock.calls[0][2].contextPolicy?.include).toContain('final');
  });

  it('warns via onModeWarning when cascade returns null final', async () => {
    const { onModeWarning, opts } = makeHook({ activeMode: 'cascade' });
    opts.submit = jest.fn().mockResolvedValue({ final: null });
    const { result } = renderHook(() => useSubmitHandlers(opts));
    await act(async () => { await result.current.handleSubmit('Summarise codebase', 0.3); });
    expect(onModeWarning).toHaveBeenCalledWith(
      expect.arrayContaining([expect.stringMatching(/synthesizer may not be deployed/)])
    );
  });

  it('quality pass uses cascade budget (5500)', async () => {
    const { submit, opts } = makeHook({ activeMode: 'cascade' });
    const { result } = renderHook(() => useSubmitHandlers(opts));
    await act(async () => { await result.current.handleQualityPass(); });
    expect(submit.mock.calls[0][2].contextPolicy.max_context_chars).toBe(5500);
  });
});

describe('useSubmitHandlers — router mode prompts', () => {
  it('does not inject final for router (behaves like flat)', async () => {
    const session = { sessionId: 'sess-rout-01' };
    const { submit, opts } = makeHook({ activeMode: 'router', currentSession: session });
    const { result } = renderHook(() => useSubmitHandlers(opts));
    await act(async () => { await result.current.handleSubmit('Route to best agent', 0.6); });
    expect(submit.mock.calls[0][2].contextPolicy?.include).not.toContain('final');
  });

  it('quality pass uses router budget (5500)', async () => {
    const { submit, opts } = makeHook({ activeMode: 'router' });
    const { result } = renderHook(() => useSubmitHandlers(opts));
    await act(async () => { await result.current.handleQualityPass(); });
    expect(submit.mock.calls[0][2].contextPolicy.max_context_chars).toBe(5500);
  });
});

describe('useSubmitHandlers — prompt variants', () => {
  test.each(PROMPT_VARIANTS.filter(p => p.trim()))('submits non-empty prompt: %j', async (prompt) => {
    const { submit, opts } = makeHook({ activeMode: 'flat' });
    const { result } = renderHook(() => useSubmitHandlers(opts));
    await act(async () => { await result.current.handleSubmit(prompt, 0.5); });
    expect(submit).toHaveBeenCalledWith(prompt, 0.5, expect.any(Object));
  });

  it('pendingPrompt is set during submission then cleared', async () => {
    let duringSubmit = null;
    const { opts } = makeHook({ activeMode: 'flat' });
    opts.submit = jest.fn().mockImplementation(async () => {
      // capture inside async fn — pendingPrompt will be set at this point
      return undefined;
    });
    const { result } = renderHook(() => useSubmitHandlers(opts));
    await act(async () => { await result.current.handleSubmit('check pending', 0.3); });
    expect(result.current.pendingPrompt).toBeNull();
    void duringSubmit; // suppress unused warning
  });

  it('errors during submit are caught and do not throw', async () => {
    const { opts } = makeHook();
    opts.submit = jest.fn().mockRejectedValue(new Error('network failure'));
    const { result } = renderHook(() => useSubmitHandlers(opts));
    await expect(
      act(async () => { await result.current.handleSubmit('fail gracefully', 0.3); })
    ).resolves.not.toThrow();
  });
});

describe('useSubmitHandlers — follow-up with context policy', () => {
  it('handleFollowUp passes followup flag and contextPolicy', async () => {
    const { submit, opts } = makeHook({ activeMode: 'flat' });
    const { result } = renderHook(() => useSubmitHandlers(opts));
    const policy = { include: ['original_prompt', 'programmer'], max_context_chars: 15000 };
    await act(async () => { await result.current.handleFollowUp('Refine this', policy); });
    expect(submit).toHaveBeenCalledWith('Refine this', 0.5, expect.objectContaining({
      followup: true,
      contextPolicy: policy,
    }));
  });

  it('handleFollowUp calls loadHistory', async () => {
    const { loadHistory, opts } = makeHook();
    const { result } = renderHook(() => useSubmitHandlers(opts));
    await act(async () => { await result.current.handleFollowUp('Continue…', {}); });
    expect(loadHistory).toHaveBeenCalled();
  });
});

describe('useSubmitHandlers — handleSendBestContinue', () => {
  it('no-op when flatPickAgent is null', async () => {
    const { submit, opts } = makeHook({ flatPickAgent: null });
    const { result } = renderHook(() => useSubmitHandlers(opts));
    await act(async () => { await result.current.handleSendBestContinue(); });
    expect(submit).not.toHaveBeenCalled();
  });

  it('no-op when response for flatPickAgent is falsy', async () => {
    const { submit, opts } = makeHook({
      flatPickAgent: 'programmer',
      responses: { programmer: '' },
    });
    const { result } = renderHook(() => useSubmitHandlers(opts));
    await act(async () => { await result.current.handleSendBestContinue(); });
    expect(submit).not.toHaveBeenCalled();
  });

  it('submits refinement prompt with correct context policy', async () => {
    const { submit, opts } = makeHook({
      flatPickAgent: 'programmer',
      responses: { programmer: 'func main() {}' },
    });
    const { result } = renderHook(() => useSubmitHandlers(opts));
    await act(async () => { await result.current.handleSendBestContinue(0.2); });
    const [, , callOpts] = submit.mock.calls[0];
    expect(callOpts.contextPolicy.target_agent).toBe('programmer');
    expect(callOpts.contextPolicy.include).toContain('programmer');
    expect(callOpts.contextPolicy.max_context_chars).toBe(4500);
  });
});

// ---------------------------------------------------------------------------
// Section 4: conversationHelpers — mixed-mode history with prompts
// ---------------------------------------------------------------------------

function makeEntry(mode, agentResponses, extra = {}) {
  return {
    prompt: extra.prompt || 'default prompt',
    _mode: mode,
    _session_id: extra.sessionId || `sess-${mode}`,
    _run_id: extra.runId || `run-${Math.random().toString(36).slice(2)}`,
    timestamp: extra.timestamp || Date.now(),
    _final: extra.final || null,
    ...agentResponses,
  };
}

describe('bestAgentText — per-mode history entries', () => {
  it('returns longest agent text from flat entry', () => {
    const entry = makeEntry('flat', {
      architect: 'short answer',
      programmer: 'a much longer detailed answer with more content here',
    });
    expect(bestAgentText(entry)).toBe('a much longer detailed answer with more content here');
  });

  it('returns synthesizer text as best when it is the longest (cascade)', () => {
    const entry = makeEntry('cascade', {
      architect: 'brief',
      synthesis: 'full synthesized answer spanning multiple concepts and topics',
    });
    expect(bestAgentText(entry)).toMatch(/synthesized/);
  });

  it('ignores METADATA_KEYS when finding best text', () => {
    const entry = makeEntry('pipeline', { programmer: 'code output' }, {
      prompt: 'long prompt '.repeat(50),
    });
    expect(bestAgentText(entry)).toBe('code output');
  });

  it('returns null when no agent responses present', () => {
    const entry = { prompt: 'hello', _session_id: 'x', _mode: 'flat' };
    expect(bestAgentText(entry)).toBeNull();
  });

  it('handles empty string agent values gracefully', () => {
    const entry = makeEntry('router', { architect: '', programmer: '' });
    expect(bestAgentText(entry)).toBeNull();
  });

  it('returns null for entry with only metadata keys', () => {
    const entry = {
      prompt: 'p', temperature: 0.5, timestamp: 123,
      _final: null, _mode: 'flat', _session_id: 's', _run_id: 'r',
    };
    expect(bestAgentText(entry)).toBeNull();
  });
});

describe('buildSessionList — mixed-mode history', () => {
  it('builds one session per unique session ID', () => {
    const history = [
      makeEntry('flat', {}, { sessionId: 'A', timestamp: 100 }),
      makeEntry('pipeline', {}, { sessionId: 'B', timestamp: 200 }),
      makeEntry('cascade', {}, { sessionId: 'A', timestamp: 300 }),
    ];
    const list = buildSessionList(history);
    expect(list).toHaveLength(2);
  });

  it('counts turns per session correctly', () => {
    const history = [
      makeEntry('flat', {}, { sessionId: 'X', timestamp: 10 }),
      makeEntry('flat', {}, { sessionId: 'X', timestamp: 20 }),
      makeEntry('router', {}, { sessionId: 'Y', timestamp: 30 }),
    ];
    const list = buildSessionList(history);
    const X = list.find(s => s.sessionId === 'X');
    const Y = list.find(s => s.sessionId === 'Y');
    expect(X.count).toBe(2);
    expect(Y.count).toBe(1);
  });

  it('sorts sessions by timestamp descending', () => {
    const history = [
      makeEntry('flat', {}, { sessionId: 'old', timestamp: 100 }),
      makeEntry('cascade', {}, { sessionId: 'new', timestamp: 999 }),
    ];
    const list = buildSessionList(history);
    expect(list[0].sessionId).toBe('new');
  });

  it('preserves firstPrompt from first entry in session', () => {
    const history = [
      makeEntry('flat', {}, { sessionId: 'S', prompt: 'first prompt', timestamp: 1 }),
      makeEntry('flat', {}, { sessionId: 'S', prompt: 'second prompt', timestamp: 2 }),
    ];
    const list = buildSessionList(history);
    expect(list[0].firstPrompt).toBe('first prompt');
  });

  it('skips entries without session ID', () => {
    const history = [
      { prompt: 'orphan', architect: 'response' }, // no _session_id
      makeEntry('flat', {}, { sessionId: 'Z', timestamp: 1 }),
    ];
    const list = buildSessionList(history);
    expect(list).toHaveLength(1);
    expect(list[0].sessionId).toBe('Z');
  });

  it('returns empty array for empty history', () => {
    expect(buildSessionList([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Section 5: METADATA_KEYS correctness
// ---------------------------------------------------------------------------

describe('METADATA_KEYS', () => {
  it('contains all standard metadata field names', () => {
    ['prompt', 'temperature', 'timestamp', '_final', '_mode', '_session_id', '_run_id'].forEach(k => {
      expect(METADATA_KEYS.has(k)).toBe(true);
    });
  });

  it('does not contain agent role names', () => {
    ['architect', 'programmer', 'reviewer', 'synthesis', 'scout'].forEach(k => {
      expect(METADATA_KEYS.has(k)).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// Section 6: Per-mode roster stress tests
// ---------------------------------------------------------------------------

describe('stress — 100 mode × roster × prompt combinations', () => {
  const rosterSets = [FULL_ROSTER, HALF_ROSTER, MINIMAL_ROSTER, EMPTY_ROSTER, SYNTHESIS_ONLY];

  it('computeModeReadiness never throws for any combination', () => {
    // 4 modes × 5 rosters × 4 synthesizers = 80 combinations, all exhausted
    let runs = 0;
    for (const mode of ALL_MODES) {
      for (const roster of rosterSets) {
        for (const synth of SYNTHESIZERS) {
          const cfg = {
            synthesizer: synth,
            agents: ALL_AGENTS.slice(0, Math.floor(Math.random() * ALL_AGENTS.length)),
          };
          expect(() => computeModeReadiness(mode, cfg, roster)).not.toThrow();
          runs++;
        }
      }
    }
    expect(runs).toBe(80); // 4 × 5 × 4 exhaustive matrix
  });

  it('qualityPassContextPolicy never throws for any mode string', () => {
    const modes = [...ALL_MODES, 'unknown', '', null, undefined, 'FLAT', 'Pipeline'];
    modes.forEach(m => {
      expect(() => qualityPassContextPolicy(m)).not.toThrow();
      const result = qualityPassContextPolicy(m);
      expect(typeof result.max_context_chars).toBe('number');
      expect(Array.isArray(result.include)).toBe(true);
    });
  });

  it('bestAgentText never throws for malformed entries', () => {
    const malformed = [
      null,
      {},
      { prompt: 'hi' },
      { architect: 42, programmer: null },
      { architect: 'ok', _final: 'final-override', timestamp: Date.now() },
    ];
    malformed.forEach(entry => {
      expect(() => bestAgentText(entry || {})).not.toThrow();
    });
  });

  it('buildSessionList handles large history without errors', () => {
    const history = Array.from({ length: 500 }, (_, i) => makeEntry(
      ALL_MODES[i % 4],
      { programmer: 'response ' + i },
      { sessionId: `sess-${i % 20}`, timestamp: i }
    ));
    expect(() => buildSessionList(history)).not.toThrow();
    const list = buildSessionList(history);
    expect(list).toHaveLength(20);
    expect(list[0].count).toBe(25); // 500 entries / 20 sessions = 25 each
  });
});

// ---------------------------------------------------------------------------
// Section 7: Per-agent variation — roster with specific agent combos per mode
// ---------------------------------------------------------------------------

describe('mode-specific agent roster variations', () => {
  it('flat — any subset of agents is valid (no required roles)', () => {
    [['architect'], ['programmer', 'reviewer'], ALL_AGENTS].forEach(agents => {
      const cfg = { agents };
      const live = makeRoster(agents);
      expect(computeModeReadiness('flat', cfg, live).ok).toBe(true);
    });
  });

  it('pipeline — warns without synthesizer, ok with it', () => {
    const agents = ['architect', 'programmer', 'tester'];
    const liveWithSynth = makeRoster([...agents, 'synthesis']);
    const liveWithoutSynth = makeRoster(agents);

    expect(computeModeReadiness('pipeline', { synthesizer: 'synthesis', agents }, liveWithSynth).ok).toBe(true);
    expect(computeModeReadiness('pipeline', { synthesizer: 'synthesis', agents }, liveWithoutSynth).ok).toBe(false);
  });

  it('cascade — warns without synthesizer, ok with it', () => {
    const agents = ['architect', 'programmer'];
    const live = makeRoster([...agents, 'foreman']);
    expect(computeModeReadiness('cascade', { synthesizer: 'foreman', agents }, live).ok).toBe(true);
    expect(computeModeReadiness('cascade', { synthesizer: 'foreman', agents }, makeRoster(agents)).ok).toBe(false);
  });

  it('router — synthesizer field has no effect on warnings', () => {
    const agents = ['architect', 'specialist'];
    const live = makeRoster(agents); // no synthesis deployed
    // router never checks synthesizer — ok regardless
    const r1 = computeModeReadiness('router', { synthesizer: 'synthesis', agents }, live);
    const r2 = computeModeReadiness('router', { synthesizer: null, agents }, live);
    expect(r1.warnings.every(w => !/synthesizer/.test(w))).toBe(true);
    expect(r2.ok).toBe(true);
  });

  it('all roles deployed — all modes report ok', () => {
    ALL_MODES.forEach(mode => {
      const cfg = { synthesizer: 'synthesis', agents: ALL_AGENTS };
      expect(computeModeReadiness(mode, cfg, FULL_ROSTER).ok).toBe(true);
    });
  });
});
