/**
 * Roster API layer stress tests.
 *
 * Tests setModeAgents, fetchModeAgents, fetchModes, setActiveMode across:
 * - All mode types (flat, pipeline, cascade, router)
 * - Every option key combination
 * - Rapid mode switches with interleaved roster saves
 * - Error paths: 400/500, unknown agents in response, stale agents
 * - 100-run concurrency and sequential stress
 */
import {
  setModeAgents,
  fetchModeAgents,
  fetchModes,
  setActiveMode,
} from './swarmApi';

// ---------------------------------------------------------------------------
// Fetch mock helpers
// ---------------------------------------------------------------------------

beforeEach(() => {
  global.fetch = jest.fn();
});

afterEach(() => {
  jest.resetAllMocks();
});

function mockOk(body) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
}

function mockFail(status, body = {}) {
  return Promise.resolve({
    ok: false,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
}

const ALL_AGENTS = ['architect', 'programmer', 'reviewer', 'foreman', 'debugger', 'tester'];

// ---------------------------------------------------------------------------
// setModeAgents — request shape
// ---------------------------------------------------------------------------

describe('setModeAgents — request body shape', () => {
  it('sends agents array', async () => {
    fetch.mockReturnValue(mockOk({ agents: ['architect'] }));
    await setModeAgents('flat', ['architect']);
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.agents).toEqual(['architect']);
  });

  it('sends empty agents to clear override', async () => {
    fetch.mockReturnValue(mockOk({ agents: [] }));
    await setModeAgents('flat', []);
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.agents).toEqual([]);
  });

  it('includes synthesizer when provided', async () => {
    fetch.mockReturnValue(mockOk({ agents: ['architect'], synthesizer: 'reviewer' }));
    await setModeAgents('cascade', ['architect'], { synthesizer: 'reviewer' });
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.synthesizer).toBe('reviewer');
  });

  it('synthesizer null clears it', async () => {
    fetch.mockReturnValue(mockOk({ agents: [] }));
    await setModeAgents('cascade', [], { synthesizer: null });
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.synthesizer).toBeNull();
  });

  it('includes maxSelect for router mode', async () => {
    fetch.mockReturnValue(mockOk({ agents: ['foreman'] }));
    await setModeAgents('router', ['foreman'], { maxSelect: 3 });
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.max_select).toBe(3);
  });

  it('includes variant_policy for flat mode', async () => {
    fetch.mockReturnValue(mockOk({ agents: ['architect'] }));
    await setModeAgents('flat', ['architect'], { variant_policy: 'distinct' });
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.variant_policy).toBe('distinct');
  });

  it('includes synthesis_policy for cascade mode', async () => {
    fetch.mockReturnValue(mockOk({ agents: ['architect'] }));
    await setModeAgents('cascade', ['architect'], { synthesis_policy: 'full-code' });
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.synthesis_policy).toBe('full-code');
  });

  it('includes classifier_policy for router mode', async () => {
    fetch.mockReturnValue(mockOk({ agents: ['foreman'] }));
    await setModeAgents('router', ['foreman'], { classifier_policy: 'code' });
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.classifier_policy).toBe('code');
  });

  it('includes order array for pipeline mode', async () => {
    const order = ['architect', 'programmer', 'tester'];
    fetch.mockReturnValue(mockOk({ agents: order, order }));
    await setModeAgents('pipeline', order, { order });
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.order).toEqual(order);
  });

  it('order null clears stage order', async () => {
    fetch.mockReturnValue(mockOk({ agents: [], order: null }));
    await setModeAgents('pipeline', [], { order: null });
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.order).toBeNull();
  });

  it('includes stage_context_chars when provided', async () => {
    fetch.mockReturnValue(mockOk({ agents: ['architect'] }));
    await setModeAgents('pipeline', ['architect'], { stage_context_chars: 4096 });
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.stage_context_chars).toBe(4096);
  });

  it('includes preset for pipeline mode', async () => {
    fetch.mockReturnValue(mockOk({ agents: ['architect'] }));
    await setModeAgents('pipeline', ['architect'], { preset: 'code-quality' });
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.preset).toBe('code-quality');
  });
});

// ---------------------------------------------------------------------------
// setModeAgents — URL targeting
// ---------------------------------------------------------------------------

describe('setModeAgents — URL construction', () => {
  it.each(['flat', 'pipeline', 'cascade', 'router'])(
    'targets /api/modes/%s/agents', async (mode) => {
      fetch.mockReturnValue(mockOk({ agents: [] }));
      await setModeAgents(mode, []);
      expect(fetch.mock.calls[0][0]).toContain(`/modes/${mode}/agents`);
    }
  );

  it('uses PUT method', async () => {
    fetch.mockReturnValue(mockOk({ agents: [] }));
    await setModeAgents('flat', []);
    expect(fetch.mock.calls[0][1].method).toBe('PUT');
  });

  it('sets Content-Type application/json', async () => {
    fetch.mockReturnValue(mockOk({ agents: [] }));
    await setModeAgents('flat', []);
    expect(fetch.mock.calls[0][1].headers['Content-Type']).toBe('application/json');
  });
});

// ---------------------------------------------------------------------------
// setModeAgents — error handling
// ---------------------------------------------------------------------------

describe('setModeAgents — error handling', () => {
  it('throws on 400 with error field', async () => {
    fetch.mockReturnValue(mockFail(400, { error: 'unknown agents: ghost' }));
    await expect(setModeAgents('flat', ['ghost'])).rejects.toThrow('unknown agents: ghost');
  });

  it('throws on 500', async () => {
    fetch.mockReturnValue(mockFail(500, {}));
    await expect(setModeAgents('flat', ['architect'])).rejects.toThrow();
  });

  it('throws on network error', async () => {
    fetch.mockReturnValue(Promise.reject(new Error('ECONNREFUSED')));
    await expect(setModeAgents('flat', ['architect'])).rejects.toThrow('ECONNREFUSED');
  });
});

// ---------------------------------------------------------------------------
// fetchModeAgents — response normalization
// ---------------------------------------------------------------------------

describe('fetchModeAgents — response normalization', () => {
  it('returns agents array', async () => {
    fetch.mockReturnValue(mockOk({ agents: ['architect', 'programmer'], explicit: true }));
    const data = await fetchModeAgents('flat');
    expect(data.agents).toEqual(['architect', 'programmer']);
    expect(data.explicit).toBe(true);
  });

  it('returns available list', async () => {
    fetch.mockReturnValue(mockOk({ agents: [], available: ALL_AGENTS }));
    const data = await fetchModeAgents('flat');
    expect(data.available).toEqual(ALL_AGENTS);
  });

  it('returns synthesizer field', async () => {
    fetch.mockReturnValue(mockOk({ agents: [], synthesizer: 'reviewer' }));
    const data = await fetchModeAgents('cascade');
    expect(data.synthesizer).toBe('reviewer');
  });

  it('returns order for pipeline', async () => {
    const order = ['architect', 'programmer', 'tester'];
    fetch.mockReturnValue(mockOk({ agents: order, order }));
    const data = await fetchModeAgents('pipeline');
    expect(data.order).toEqual(order);
  });

  it('returns stale list when present', async () => {
    fetch.mockReturnValue(mockOk({ agents: ['ghost'], stale: ['ghost'] }));
    const data = await fetchModeAgents('flat');
    expect(data.stale).toContain('ghost');
  });

  it('throws on non-ok response', async () => {
    fetch.mockReturnValue(mockFail(404));
    await expect(fetchModeAgents('nonexistent')).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// fetchModes + setActiveMode
// ---------------------------------------------------------------------------

describe('fetchModes + setActiveMode', () => {
  it('fetchModes returns mode list', async () => {
    const modes = [
      { name: 'flat', active: true },
      { name: 'pipeline', active: false },
    ];
    fetch.mockReturnValue(mockOk(modes));
    const result = await fetchModes();
    expect(result).toEqual(modes);
  });

  it('setActiveMode sends mode name', async () => {
    fetch.mockReturnValue(mockOk({ active: 'pipeline' }));
    await setActiveMode('pipeline');
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.mode).toBe('pipeline');
  });

  it.each(['flat', 'pipeline', 'cascade', 'router'])(
    'setActiveMode succeeds for mode %s', async (mode) => {
      fetch.mockReturnValue(mockOk({ active: mode }));
      await expect(setActiveMode(mode)).resolves.not.toThrow();
    }
  );

  it('setActiveMode throws on 400 unknown mode', async () => {
    fetch.mockReturnValue(mockFail(400, { error: 'unknown mode: foo' }));
    await expect(setActiveMode('foo')).rejects.toThrow('unknown mode: foo');
  });
});

// ---------------------------------------------------------------------------
// Rapid mode switch + roster save
// ---------------------------------------------------------------------------

describe('Rapid mode switch + roster save', () => {
  const MODES = ['flat', 'pipeline', 'cascade', 'router'];

  it('10 sequential mode switches all succeed', async () => {
    fetch.mockImplementation((url, opts) => {
      const body = opts?.body ? JSON.parse(opts.body) : {};
      return mockOk({ active: body.mode || 'flat' });
    });
    const failures = [];
    for (const mode of [...MODES, ...MODES, 'flat']) {
      try {
        await setActiveMode(mode);
      } catch (e) {
        failures.push(`mode=${mode}: ${e.message}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('interleaved mode switch + roster save', async () => {
    let callN = 0;
    fetch.mockImplementation((url) => {
      callN++;
      if (url.includes('/agents')) return mockOk({ agents: ['architect'] });
      return mockOk({ active: 'pipeline' });
    });
    const ops = [];
    for (let i = 0; i < 10; i++) {
      const mode = MODES[i % MODES.length];
      ops.push(setActiveMode(mode));
      ops.push(setModeAgents(mode, ['architect'], {}));
    }
    await expect(Promise.all(ops)).resolves.toHaveLength(20);
  });
});

// ---------------------------------------------------------------------------
// All mode × agent subset combinations (stress)
// ---------------------------------------------------------------------------

describe('setModeAgents stress — all mode × agent subset × option combos', () => {
  const MODES = ['flat', 'pipeline', 'cascade', 'router'];
  const SYNTHESIS_POLICIES  = ['summary', 'full-code', 'best-answer-plus-fixes'];
  const VARIANT_POLICIES    = ['standard', 'distinct', 'code-alternatives'];
  const CLASSIFIER_POLICIES = ['standard', 'code', 'debug', 'docs', 'ops'];

  it('100 random mode/agent/option calls — correct URL and body every time', async () => {
    const failures = [];

    for (let run = 0; run < 100; run++) {
      const mode = MODES[run % MODES.length];
      const agents = ALL_AGENTS.filter(() => Math.random() > 0.5);
      const opts = {};
      if (mode === 'pipeline' || mode === 'cascade') {
        opts.synthesizer = ALL_AGENTS[run % ALL_AGENTS.length];
      }
      if (mode === 'flat') {
        opts.variant_policy = VARIANT_POLICIES[run % VARIANT_POLICIES.length];
      }
      if (mode === 'cascade') {
        opts.synthesis_policy = SYNTHESIS_POLICIES[run % SYNTHESIS_POLICIES.length];
      }
      if (mode === 'router') {
        opts.maxSelect = (run % 4) + 1;
        opts.classifier_policy = CLASSIFIER_POLICIES[run % CLASSIFIER_POLICIES.length];
      }
      if (mode === 'pipeline') {
        opts.preset = 'code-quality';
        if (run % 3 === 0) {
          opts.order = agents.slice(0, 2);
        }
      }

      fetch.mockReturnValue(mockOk({ agents }));

      let capturedUrl, capturedBody;
      fetch.mockImplementation((url, fetchOpts) => {
        capturedUrl = url;
        capturedBody = JSON.parse(fetchOpts?.body || '{}');
        return mockOk({ agents });
      });

      try {
        await setModeAgents(mode, agents, opts);
      } catch (e) {
        failures.push(`run ${run}: threw ${e.message}`);
        continue;
      }

      if (!capturedUrl.includes(`/modes/${mode}/agents`)) {
        failures.push(`run ${run}: wrong URL ${capturedUrl}`);
      }
      if (!Array.isArray(capturedBody.agents)) {
        failures.push(`run ${run}: agents not array`);
      }
      if (mode === 'flat' && capturedBody.variant_policy !== opts.variant_policy) {
        failures.push(`run ${run} flat: variant_policy mismatch`);
      }
      if (mode === 'cascade' && capturedBody.synthesis_policy !== opts.synthesis_policy) {
        failures.push(`run ${run} cascade: synthesis_policy mismatch`);
      }
      if (mode === 'router' && Number.isInteger(opts.maxSelect)) {
        if (capturedBody.max_select !== opts.maxSelect) {
          failures.push(`run ${run} router: max_select mismatch`);
        }
      }
    }
    expect(failures).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Concurrent roster saves across all modes
// ---------------------------------------------------------------------------

describe('setModeAgents stress — 100 concurrent saves', () => {
  it('all succeed when server is healthy', async () => {
    fetch.mockImplementation((url) => {
      const mode = url.match(/\/modes\/([^/]+)\/agents/)?.[1] || 'unknown';
      return mockOk({ agents: ['architect'], mode });
    });

    const modes = ['flat', 'pipeline', 'cascade', 'router'];
    const calls = Array.from({ length: 100 }, (_, i) =>
      setModeAgents(modes[i % modes.length], ['architect'], {})
    );

    const results = await Promise.all(calls);
    expect(results).toHaveLength(100);
    expect(results.every(r => Array.isArray(r.agents))).toBe(true);
  });

  it('partial failures do not block others', async () => {
    let n = 0;
    fetch.mockImplementation(() => {
      n++;
      if (n % 5 === 0) return mockFail(503, {});
      return mockOk({ agents: ['architect'] });
    });

    const results = await Promise.allSettled(
      Array.from({ length: 100 }, (_, i) =>
        setModeAgents(['flat', 'pipeline', 'cascade', 'router'][i % 4], ['architect'], {})
      )
    );

    const ok = results.filter(r => r.status === 'fulfilled').length;
    const fail = results.filter(r => r.status === 'rejected').length;
    expect(ok + fail).toBe(100);
    expect(fail).toBeGreaterThan(0);
    expect(ok).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Agent roster combinations across all mode types
// ---------------------------------------------------------------------------

describe('setModeAgents — agent roster variations', () => {
  beforeEach(() => {
    fetch.mockImplementation((_, opts) => {
      const { agents } = JSON.parse(opts.body || '{}');
      return mockOk({ agents: agents || [] });
    });
  });

  it('single agent in each mode', async () => {
    for (const mode of ['flat', 'pipeline', 'cascade', 'router']) {
      const res = await setModeAgents(mode, ['architect'], {});
      expect(res.agents).toEqual(['architect']);
    }
  });

  it('full roster in each mode', async () => {
    for (const mode of ['flat', 'pipeline', 'cascade', 'router']) {
      const res = await setModeAgents(mode, ALL_AGENTS, {});
      expect(res.agents).toEqual(ALL_AGENTS);
    }
  });

  it('empty roster clears override', async () => {
    for (const mode of ['flat', 'pipeline', 'cascade', 'router']) {
      const res = await setModeAgents(mode, [], {});
      expect(res.agents).toEqual([]);
    }
  });

  it('pipeline allows duplicate agents in roster', async () => {
    const roster = ['architect', 'programmer', 'architect'];
    const res = await setModeAgents('pipeline', roster, {});
    expect(res.agents).toEqual(roster);
  });

  it('large roster (all 6 agents × 2 in pipeline)', async () => {
    const roster = [...ALL_AGENTS, ...ALL_AGENTS];
    const res = await setModeAgents('pipeline', roster, {});
    expect(res.agents).toEqual(roster);
  });
});

// ---------------------------------------------------------------------------
// Chaos monkey: malformed server responses
// ---------------------------------------------------------------------------

describe('rosterApi chaos — malformed server responses', () => {
  const MODES = ['flat', 'pipeline', 'cascade', 'router'];

  it('fetchModeAgents survives null json body', async () => {
    fetch.mockReturnValue(Promise.resolve({
      ok: true, status: 200,
      json: async () => null,
      text: async () => 'null',
    }));
    const data = await fetchModeAgents('flat');
    expect(Array.isArray(data.agents)).toBe(true);
  });

  it('fetchModeAgents survives completely empty object', async () => {
    fetch.mockReturnValue(mockOk({}));
    const data = await fetchModeAgents('pipeline');
    expect(Array.isArray(data.agents)).toBe(true);
    expect(Array.isArray(data.available)).toBe(true);
  });

  it('fetchModeAgents: agents field is a number — normalises to empty array', async () => {
    fetch.mockReturnValue(mockOk({ agents: 42, available: 'oops' }));
    const data = await fetchModeAgents('flat');
    expect(data.agents).toEqual([]);
    expect(data.available).toEqual([]);
  });

  it('fetchModes survives non-array response', async () => {
    fetch.mockReturnValue(mockOk({ modes: 'flat' }));
    const modes = await fetchModes();
    expect(Array.isArray(modes)).toBe(true);
  });

  it('setModeAgents: server echoes wrong mode in response — no throw', async () => {
    fetch.mockReturnValue(mockOk({ agents: [], mode: 'wrong-mode' }));
    await expect(setModeAgents('flat', [], {})).resolves.not.toThrow();
  });

  it('setModeAgents: server returns 500 with HTML body — throws cleanly', async () => {
    fetch.mockReturnValue(Promise.resolve({
      ok: false, status: 500,
      json: async () => { throw new SyntaxError('Unexpected token'); },
      text: async () => '<html>Internal Server Error</html>',
    }));
    await expect(setModeAgents('flat', [], {})).rejects.toThrow();
  });

  it('fetch throws NetworkError — rejects with message', async () => {
    fetch.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(fetchModeAgents('flat')).rejects.toThrow('Failed to fetch');
  });
});

// ---------------------------------------------------------------------------
// Chaos monkey: 100 random response shapes — fetchModeAgents never throws
// ---------------------------------------------------------------------------

describe('rosterApi chaos — 100 random fetchModeAgents response shapes', () => {
  it('normalises every shape without throwing', async () => {
    const failures = [];
    const MODES = ['flat', 'pipeline', 'cascade', 'router'];

    for (let i = 0; i < 100; i++) {
      const shape = Math.floor(Math.random() * 8);
      const body = [
        null,
        {},
        { agents: null },
        { agents: [], available: null, stale: 'ghost' },
        { agents: ['a', 'b'], available: ['c'], stale: ['d'], explicit: true },
        { agents: [1, 2, 3] },                // non-string agent names
        { agents: [], synthesizer: 42 },       // wrong type
        { agents: [], order: 'not-an-array' }, // wrong type
      ][shape];

      const mode = MODES[i % MODES.length];
      fetch.mockReturnValue(mockOk(body));

      let data;
      try {
        data = await fetchModeAgents(mode);
      } catch (e) {
        failures.push(`run ${i} shape=${shape}: threw ${e.message}`);
        continue;
      }

      if (!Array.isArray(data.agents))    failures.push(`run ${i}: agents not array`);
      if (!Array.isArray(data.available)) failures.push(`run ${i}: available not array`);
      if (data.stale !== undefined && !Array.isArray(data.stale)) {
        failures.push(`run ${i}: stale present but not array`);
      }
    }
    expect(failures).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Chaos monkey: 100 random setModeAgents option payloads — URL + body always valid
// ---------------------------------------------------------------------------

describe('rosterApi chaos — 100 random setModeAgents payloads', () => {
  const MODES = ['flat', 'pipeline', 'cascade', 'router'];
  const ALL_AGENTS = ['architect', 'programmer', 'reviewer', 'tester', 'documenter', 'foreman'];

  it('every call uses PUT and correct URL, body is valid JSON', async () => {
    const failures = [];

    for (let i = 0; i < 100; i++) {
      const mode = MODES[Math.floor(Math.random() * MODES.length)];
      const n = Math.floor(Math.random() * ALL_AGENTS.length);
      const agents = ALL_AGENTS.slice(0, n);

      // Random valid option mix for this mode
      const opts = {};
      if (mode === 'flat')     opts.variant_policy    = ['standard','creative'][i % 2];
      if (mode === 'pipeline') opts.synthesizer        = Math.random() < 0.5 ? 'foreman' : '';
      if (mode === 'cascade')  opts.synthesis_policy  = 'summary';
      if (mode === 'router')   opts.classifier_policy = 'standard';
      if (mode === 'pipeline' && Math.random() < 0.4) opts.order = agents.slice(0, 2);
      if (Math.random() < 0.2) opts.stage_context_chars = Math.floor(Math.random() * 4000) + 500;

      let capturedUrl, capturedMethod, capturedBody;
      fetch.mockImplementation((url, reqOpts) => {
        capturedUrl   = url;
        capturedMethod = reqOpts?.method;
        try { capturedBody = JSON.parse(reqOpts?.body); } catch { capturedBody = null; }
        return mockOk({ agents });
      });

      try {
        await setModeAgents(mode, agents, opts);
      } catch (e) {
        failures.push(`run ${i} ${mode}: threw ${e.message}`);
        continue;
      }

      if (capturedMethod !== 'PUT') failures.push(`run ${i}: method ${capturedMethod}`);
      if (!capturedUrl?.includes(`/modes/${mode}/agents`)) failures.push(`run ${i}: bad URL ${capturedUrl}`);
      if (!Array.isArray(capturedBody?.agents)) failures.push(`run ${i}: body.agents not array`);
    }
    expect(failures).toEqual([]);
  });
});
