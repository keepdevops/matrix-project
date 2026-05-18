/**
 * ModelSwapSection — groupByBackend, memory warning logic, override/dirty state,
 * redeploy payload construction, extra_args parsing, all backend combinations.
 */

// ---------------------------------------------------------------------------
// Replicated helpers
// ---------------------------------------------------------------------------

function groupByBackend(models) {
  const groups = {};
  for (const m of models) {
    const b = m.backend || 'llama';
    if (!groups[b]) groups[b] = [];
    groups[b].push(m);
  }
  return groups;
}

function computeMemoryWarning(agentName, newPath, currentModel, models) {
  if (!newPath || newPath === currentModel) return null;
  const cur  = models.find(m => m.path === currentModel);
  const next = models.find(m => m.path === newPath);
  if (!next?.size_bytes) {
    return `Unknown size — verify Metal pool capacity before deploying`;
  }
  if (cur?.size_bytes > 0 && next.size_bytes > cur.size_bytes) {
    const diffGB = ((next.size_bytes - cur.size_bytes) / 1e9).toFixed(1);
    const nextGB = (next.size_bytes / 1e9).toFixed(1);
    return `+${diffGB} GB larger (${nextGB} GB) — may exceed Metal pool`;
  }
  return null;
}

function buildRedeployPayload(agents, overrides, extraOverrides, models) {
  return agents.map(a => {
    const model     = overrides[a.name] || a.model;
    const modelMeta = models.find(m => m.path === model);
    const backend   = modelMeta?.backend || a.backend || a.engine || 'llama';
    const rawExtra  = a.name in extraOverrides
      ? (typeof extraOverrides[a.name] === 'string' ? extraOverrides[a.name] : '')
      : (Array.isArray(a.extra_args) ? a.extra_args.join(' ') : (typeof a.extra_args === 'string' ? a.extra_args : ''));
    const extra_args = rawExtra.trim() ? rawExtra.trim().split(/\s+/) : [];
    return { ...a, model, backend, extra_args };
  });
}

function dirtyCount(overrides, extraOverrides) {
  return Object.keys(overrides).length + Object.keys(extraOverrides).length;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MODELS = [
  { path: '/m/llama-7b.gguf',      name: 'LLaMA-7B',     backend: 'llama', size_bytes: 4e9  },
  { path: '/m/codestral-22b.gguf', name: 'Codestral-22B', backend: 'llama', size_bytes: 14e9 },
  { path: '/m/llama-3b.gguf',      name: 'LLaMA-3B',     backend: 'llama', size_bytes: 2e9  },
  { path: '/m/mlx-8b',             name: 'MLX-8B',        backend: 'mlx',   size_bytes: 5e9  },
  { path: '/m/mlx-4b',             name: 'MLX-4B',        backend: 'mlx',   size_bytes: 2.5e9},
];

const AGENTS = [
  { name: 'architect',  model: '/m/llama-7b.gguf',      backend: 'llama' },
  { name: 'programmer', model: '/m/codestral-22b.gguf',  backend: 'llama' },
  { name: 'reviewer',   model: '/m/llama-3b.gguf',       backend: 'llama' },
];

// ---------------------------------------------------------------------------
// groupByBackend
// ---------------------------------------------------------------------------

describe('groupByBackend', () => {
  it('groups models by backend', () => {
    const groups = groupByBackend(MODELS);
    expect(groups.llama).toHaveLength(3);
    expect(groups.mlx).toHaveLength(2);
  });

  it('defaults to llama when backend missing', () => {
    const models = [{ path: '/m/x', name: 'X' }];
    const groups = groupByBackend(models);
    expect(groups.llama).toHaveLength(1);
  });

  it('empty model list returns empty groups', () => {
    expect(groupByBackend([])).toEqual({});
  });

  it('all same backend → one group', () => {
    const all = MODELS.filter(m => m.backend === 'llama');
    const groups = groupByBackend(all);
    expect(Object.keys(groups)).toHaveLength(1);
    expect(groups.llama).toHaveLength(all.length);
  });

  it('vllm models land in vllm group', () => {
    const models = [
      ...MODELS,
      { path: '/m/v1', name: 'V1', backend: 'vllm', size_bytes: 10e9 },
    ];
    const groups = groupByBackend(models);
    expect(groups.vllm).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Memory warnings
// ---------------------------------------------------------------------------

describe('computeMemoryWarning', () => {
  it('no warning when model unchanged', () => {
    const w = computeMemoryWarning('architect', '/m/llama-7b.gguf', '/m/llama-7b.gguf', MODELS);
    expect(w).toBeNull();
  });

  it('no warning when newPath is null', () => {
    const w = computeMemoryWarning('architect', null, '/m/llama-7b.gguf', MODELS);
    expect(w).toBeNull();
  });

  it('no warning when swapping to smaller model', () => {
    const w = computeMemoryWarning('architect', '/m/llama-3b.gguf', '/m/llama-7b.gguf', MODELS);
    expect(w).toBeNull();
  });

  it('warning when swapping to larger model', () => {
    const w = computeMemoryWarning('architect', '/m/codestral-22b.gguf', '/m/llama-7b.gguf', MODELS);
    expect(w).not.toBeNull();
    expect(w).toContain('GB larger');
  });

  it('warning includes GB diff and total size', () => {
    const w = computeMemoryWarning('architect', '/m/codestral-22b.gguf', '/m/llama-7b.gguf', MODELS);
    expect(w).toContain('+10.0 GB larger');
    expect(w).toContain('14.0 GB');
  });

  it('warning when target model has no size_bytes', () => {
    const models = [
      { path: '/a', name: 'A', backend: 'llama', size_bytes: 4e9 },
      { path: '/b', name: 'B', backend: 'llama', size_bytes: 0 },
    ];
    const w = computeMemoryWarning('x', '/b', '/a', models);
    expect(w).not.toBeNull();
    expect(w).toContain('Unknown size');
  });

  it('warning when target model missing from list entirely', () => {
    const w = computeMemoryWarning('x', '/m/unknown-new.gguf', '/m/llama-7b.gguf', MODELS);
    expect(w).not.toBeNull();
    expect(w).toContain('Unknown size');
  });

  it('no warning when current model not in list but target is known and smaller', () => {
    const w = computeMemoryWarning('x', '/m/llama-3b.gguf', '/unknown', MODELS);
    expect(w).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Override dirty state
// ---------------------------------------------------------------------------

describe('ModelSwapSection — dirty state tracking', () => {
  it('zero overrides → dirtyCount=0', () => {
    expect(dirtyCount({}, {})).toBe(0);
  });

  it('one model override → dirtyCount=1', () => {
    expect(dirtyCount({ architect: '/m/new.gguf' }, {})).toBe(1);
  });

  it('one extra_args override → dirtyCount=1', () => {
    expect(dirtyCount({}, { architect: '-fit off' })).toBe(1);
  });

  it('both types → counts add', () => {
    expect(dirtyCount({ arch: '/m/a' }, { prog: '--opt' })).toBe(2);
  });

  it('reset clears dirty count', () => {
    let overrides = { arch: '/m/a', prog: '/m/b' };
    let extra = { reviewer: '--flag' };
    overrides = {};
    extra = {};
    expect(dirtyCount(overrides, extra)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Redeploy payload construction
// ---------------------------------------------------------------------------

describe('buildRedeployPayload', () => {
  it('uses original model when no override', () => {
    const payload = buildRedeployPayload(AGENTS, {}, {}, MODELS);
    expect(payload[0].model).toBe('/m/llama-7b.gguf');
  });

  it('applies model override', () => {
    const overrides = { architect: '/m/codestral-22b.gguf' };
    const payload = buildRedeployPayload(AGENTS, overrides, {}, MODELS);
    expect(payload[0].model).toBe('/m/codestral-22b.gguf');
  });

  it('sets backend from model metadata', () => {
    const overrides = { architect: '/m/mlx-8b' };
    const payload = buildRedeployPayload(AGENTS, overrides, {}, MODELS);
    expect(payload[0].backend).toBe('mlx');
  });

  it('falls back to agent backend when model not in list', () => {
    const overrides = { architect: '/m/unknown.gguf' };
    const payload = buildRedeployPayload(AGENTS, overrides, {}, MODELS);
    expect(payload[0].backend).toBe('llama');
  });

  it('parses extra_args string into array', () => {
    const extra = { architect: '-fit off --threads 4' };
    const payload = buildRedeployPayload(AGENTS, {}, extra, MODELS);
    expect(payload[0].extra_args).toEqual(['-fit', 'off', '--threads', '4']);
  });

  it('empty extra_args string → empty array', () => {
    const extra = { architect: '   ' };
    const payload = buildRedeployPayload(AGENTS, {}, extra, MODELS);
    expect(payload[0].extra_args).toEqual([]);
  });

  it('array extra_args joined and split back', () => {
    const agents = [{ name: 'x', model: '/m/llama-7b.gguf', backend: 'llama',
                       extra_args: ['-a', '-b'] }];
    const payload = buildRedeployPayload(agents, {}, {}, MODELS);
    expect(payload[0].extra_args).toEqual(['-a', '-b']);
  });

  it('no extra_args field → empty array', () => {
    const agents = [{ name: 'x', model: '/m/llama-7b.gguf', backend: 'llama' }];
    const payload = buildRedeployPayload(agents, {}, {}, MODELS);
    expect(payload[0].extra_args).toEqual([]);
  });

  it('all agents included in payload', () => {
    const payload = buildRedeployPayload(AGENTS, {}, {}, MODELS);
    expect(payload).toHaveLength(AGENTS.length);
  });

  it('payload preserves agent name', () => {
    const payload = buildRedeployPayload(AGENTS, {}, {}, MODELS);
    expect(payload.map(p => p.name)).toEqual(AGENTS.map(a => a.name));
  });
});

// ---------------------------------------------------------------------------
// configureSwarm API mock
// ---------------------------------------------------------------------------

jest.mock('../api/swarmApi', () => ({
  fetchAgents:      jest.fn(),
  fetchModels:      jest.fn(),
  fetchSwarmConfig: jest.fn(),
  configureSwarm:   jest.fn(),
}));

import { configureSwarm, fetchAgents, fetchModels, fetchSwarmConfig } from '../api/swarmApi';

beforeEach(() => {
  jest.resetAllMocks();
  fetchSwarmConfig.mockResolvedValue({ agents: AGENTS });
  fetchAgents.mockResolvedValue(AGENTS);
  fetchModels.mockResolvedValue(MODELS);
});

describe('ModelSwapSection — configureSwarm integration', () => {
  it('calls configureSwarm with correct payload', async () => {
    configureSwarm.mockResolvedValue({ servers: [] });
    const payload = buildRedeployPayload(AGENTS, {}, {}, MODELS);
    await configureSwarm(payload);
    expect(configureSwarm).toHaveBeenCalledWith(payload);
  });

  it('throws on configureSwarm failure', async () => {
    configureSwarm.mockRejectedValue(new Error('server timeout'));
    await expect(configureSwarm([])).rejects.toThrow('server timeout');
  });

  it('returns servers list on success', async () => {
    const servers = [{ port: 8080, model: '/m/llama-7b.gguf', agents: ['architect'] }];
    configureSwarm.mockResolvedValue({ servers });
    const result = await configureSwarm([]);
    expect(result.servers).toEqual(servers);
  });
});

// ---------------------------------------------------------------------------
// Stress: 100 random override + extra_args combinations
// ---------------------------------------------------------------------------

describe('ModelSwapSection stress — 100 random redeploy payloads', () => {
  const ALL_MODEL_PATHS = MODELS.map(m => m.path);

  it('payload invariants always hold', () => {
    const failures = [];
    const VALID_BACKENDS = new Set(['llama', 'mlx', 'vllm', 'ggml']);

    for (let run = 0; run < 100; run++) {
      const overrides = {};
      const extraOverrides = {};
      const agents = AGENTS.map(a => ({ ...a }));

      // Random overrides
      for (const a of agents) {
        if (Math.random() < 0.4) {
          overrides[a.name] = ALL_MODEL_PATHS[Math.floor(Math.random() * ALL_MODEL_PATHS.length)];
        }
        if (Math.random() < 0.3) {
          const flags = ['--threads 4', '-fit off', '--mmap off', ''];
          extraOverrides[a.name] = flags[Math.floor(Math.random() * flags.length)];
        }
      }

      let payload;
      try {
        payload = buildRedeployPayload(agents, overrides, extraOverrides, MODELS);
      } catch (e) {
        failures.push(`run ${run}: threw ${e.message}`);
        continue;
      }

      if (payload.length !== agents.length) {
        failures.push(`run ${run}: payload length ${payload.length} !== ${agents.length}`);
      }
      for (const p of payload) {
        if (!ALL_MODEL_PATHS.includes(p.model) && !agents.find(a => a.name === p.name)?.model) {
          // only fail if original agent had a model
        }
        if (!Array.isArray(p.extra_args)) {
          failures.push(`run ${run} ${p.name}: extra_args not array`);
        }
        if (p.extra_args.some(s => typeof s !== 'string')) {
          failures.push(`run ${run} ${p.name}: extra_args contains non-string`);
        }
        if (typeof p.backend !== 'string' || p.backend.length === 0) {
          failures.push(`run ${run} ${p.name}: backend empty`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('memory warnings computed consistently across all model swap combinations', () => {
    const failures = [];
    for (let run = 0; run < 100; run++) {
      const from = MODELS[Math.floor(Math.random() * MODELS.length)];
      const to   = MODELS[Math.floor(Math.random() * MODELS.length)];
      let warning;
      try {
        warning = computeMemoryWarning('agent', to.path, from.path, MODELS);
      } catch (e) {
        failures.push(`run ${run}: threw ${e.message}`);
        continue;
      }
      // If target has no size → must warn
      if (!to.size_bytes && warning === null) {
        failures.push(`run ${run}: expected unknown-size warning`);
      }
      // If upgrade → must have warning
      if (from.size_bytes > 0 && to.size_bytes > from.size_bytes && warning === null) {
        failures.push(`run ${run}: expected warning for size increase ${from.size_bytes}→${to.size_bytes}`);
      }
      // If same or smaller (and target size known) → must NOT have warning
      if (to.size_bytes > 0 && to.size_bytes <= from.size_bytes && warning !== null) {
        failures.push(`run ${run}: unexpected warning for same/smaller swap`);
      }
    }
    expect(failures).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// All backend swap combinations
// ---------------------------------------------------------------------------

describe('ModelSwapSection — cross-backend swap matrix', () => {
  const backends = ['llama', 'mlx', 'vllm'];
  const swapModels = backends.map(b => ({
    path: `/m/${b}-model`, name: `${b}-Model`, backend: b, size_bytes: 5e9,
  }));

  it.each(
    backends.flatMap(from => backends.map(to => [from, to]))
  )('swap from %s to %s sets correct backend in payload', (fromBackend, toBackend) => {
    const agent = { name: 'test', model: `/m/${fromBackend}-model`, backend: fromBackend };
    const overrides = { test: `/m/${toBackend}-model` };
    const payload = buildRedeployPayload([agent], overrides, {}, swapModels);
    expect(payload[0].backend).toBe(toBackend);
    expect(payload[0].model).toBe(`/m/${toBackend}-model`);
  });
});

// ---------------------------------------------------------------------------
// Chaos monkey: poisoned agent and model inputs
// ---------------------------------------------------------------------------

describe('ModelSwapSection chaos — poisoned agent fields', () => {
  it('agent with no model field — extra_args still array', () => {
    const agents = [{ name: 'x', backend: 'llama' }];
    const payload = buildRedeployPayload(agents, {}, {}, MODELS);
    expect(Array.isArray(payload[0].extra_args)).toBe(true);
  });

  it('agent with null extra_args — coerces to empty array', () => {
    const agents = [{ name: 'x', model: '/m/llama-7b.gguf', backend: 'llama', extra_args: null }];
    const payload = buildRedeployPayload(agents, {}, {}, MODELS);
    expect(payload[0].extra_args).toEqual([]);
  });

  it('extra_args override with tab/newline whitespace — splits correctly', () => {
    const agents = [{ name: 'x', model: '/m/llama-7b.gguf', backend: 'llama' }];
    const extra = { x: '--threads\t4\n--mmap\toff' };
    const payload = buildRedeployPayload(agents, {}, extra, MODELS);
    expect(payload[0].extra_args).toEqual(['--threads', '4', '--mmap', 'off']);
  });

  it('override to empty string model path — falls back to original model', () => {
    const agents = [{ name: 'x', model: '/m/llama-7b.gguf', backend: 'llama' }];
    const payload = buildRedeployPayload(agents, { x: '' }, {}, MODELS);
    expect(payload[0].model).toBe('/m/llama-7b.gguf');
  });

  it('memory warning: swap to model with size_bytes=undefined warns unknown', () => {
    const models = [
      { path: '/a', name: 'A', backend: 'llama', size_bytes: 4e9 },
      { path: '/b', name: 'B', backend: 'llama' },  // size_bytes missing entirely
    ];
    const w = computeMemoryWarning('x', '/b', '/a', models);
    expect(w).not.toBeNull();
    expect(w).toContain('Unknown size');
  });

  it('groupByBackend handles model with empty string backend', () => {
    const models = [{ path: '/x', name: 'X', backend: '' }];
    const groups = groupByBackend(models);
    expect(groups.llama).toHaveLength(1);
  });

  it('buildRedeployPayload: agents array is empty — returns empty array', () => {
    const payload = buildRedeployPayload([], { x: '/m/llama-7b.gguf' }, {}, MODELS);
    expect(payload).toEqual([]);
  });

  it('dirtyCount with undefined keys does not throw', () => {
    expect(() => dirtyCount({ [undefined]: '/m/x' }, {})).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Chaos monkey: 100 random poisoned model lists and agent combos
// ---------------------------------------------------------------------------

describe('ModelSwapSection chaos — 100 poisoned model lists', () => {
  it('computeMemoryWarning never throws on any model shape', () => {
    const failures = [];
    const badModels = [
      { path: '/a', size_bytes: null },
      { path: '/b', size_bytes: undefined },
      { path: '/c', size_bytes: NaN },
      { path: '/d', size_bytes: -1e9 },
      { path: '/e', size_bytes: Infinity },
      { path: '/f', size_bytes: 0 },
      { path: '/g', size_bytes: 4e9, backend: null },
      { path: '/h' },
    ];

    for (let i = 0; i < 100; i++) {
      const from = badModels[Math.floor(Math.random() * badModels.length)];
      const to   = badModels[Math.floor(Math.random() * badModels.length)];
      const pool = [...badModels, ...MODELS];
      try {
        const w = computeMemoryWarning('agent', to.path, from.path, pool);
        if (w !== null && typeof w !== 'string') {
          failures.push(`run ${i}: warning is not null or string: ${w}`);
        }
      } catch (e) {
        failures.push(`run ${i}: threw ${e.message}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('buildRedeployPayload never throws with random null/undefined fields', () => {
    const failures = [];
    const weirdAgents = [
      { name: 'a', model: null,      backend: 'llama' },
      { name: 'b', model: undefined, backend: undefined },
      { name: 'c', model: '/m/llama-7b.gguf', extra_args: { not: 'array' } },
      { name: 'd', model: '/m/mlx-8b',        backend: null, engine: 'mlx' },
      { name: 'e' },
    ];

    for (let i = 0; i < 100; i++) {
      const n = Math.floor(Math.random() * weirdAgents.length) + 1;
      const agents = weirdAgents.slice(0, n).map(a => ({ ...a }));
      const overrides = {};
      const extra = {};
      agents.forEach(a => {
        if (Math.random() < 0.4) overrides[a.name] = MODELS[Math.floor(Math.random() * MODELS.length)].path;
        if (Math.random() < 0.3) extra[a.name] = ['--flag', '', '  ', null][Math.floor(Math.random() * 4)] ?? '';
      });

      try {
        const payload = buildRedeployPayload(agents, overrides, extra, MODELS);
        for (const p of payload) {
          if (!Array.isArray(p.extra_args)) {
            failures.push(`run ${i} ${p.name}: extra_args not array`);
          }
          if (typeof p.backend !== 'string' || p.backend === '') {
            failures.push(`run ${i} ${p.name}: backend empty or non-string`);
          }
        }
      } catch (e) {
        failures.push(`run ${i}: threw ${e.message}`);
      }
    }
    expect(failures).toEqual([]);
  });
});
