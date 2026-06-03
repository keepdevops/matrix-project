import {
  computeLayout,
  getProfileRoles,
  chooseModelForRole,
  parseModelSizeBillions,
  getEngineLabel,
  shortName,
  ENGINES,
  PROFILE_SAFE,
  PROFILE_BALANCED,
  PROFILE_MAX,
  PROFILE_MIXED,
} from './SwarmConfig.helpers';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const LLAMA_MODELS = [
  { path: '/models/llama-3b.gguf',       name: 'Llama-3B',     backend: 'llama' },
  { path: '/models/llama-7b.gguf',       name: 'Llama-7B',     backend: 'llama' },
  { path: '/models/codestral-22b.gguf',  name: 'Codestral-22B', backend: 'llama' },
  { path: '/models/llama-13b.gguf',      name: 'Llama-13B',    backend: 'llama' },
];

const MLX_MODELS = [
  { path: '/models/mlx-4b',  name: 'MLX-4B',  backend: 'mlx' },
  { path: '/models/mlx-8b',  name: 'MLX-8B',  backend: 'mlx' },
];

const VLLM_MODELS = [
  { path: '/models/vllm-14b', name: 'VLLM-14B', backend: 'vllm' },
];

const ALL_MODELS = [...LLAMA_MODELS, ...MLX_MODELS, ...VLLM_MODELS];

function makeRoles(names, ctxMap = {}, extras = {}) {
  return names.map(name => ({
    name,
    context: ctxMap[name] ?? 2048,
    engine: 'llama',
    ...extras,
  }));
}

// ---------------------------------------------------------------------------
// shortName
// ---------------------------------------------------------------------------

describe('shortName', () => {
  it('strips .gguf extension', () => {
    expect(shortName('/models/llama-7b.gguf')).toBe('llama-7b');
  });

  it('returns basename when no extension', () => {
    expect(shortName('/models/mlx-4b')).toBe('mlx-4b');
  });

  it('handles single-component path', () => {
    expect(shortName('model.gguf')).toBe('model');
  });

  it('handles empty string', () => {
    expect(shortName('')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// getEngineLabel
// ---------------------------------------------------------------------------

describe('getEngineLabel', () => {
  it('returns LLAMA for llama', () => {
    expect(getEngineLabel('llama')).toBe('LLAMA');
  });

  it('returns MLX for mlx', () => {
    expect(getEngineLabel('mlx')).toBe('MLX');
  });

  it('returns vLLM for vllm', () => {
    expect(getEngineLabel('vllm')).toBe('vLLM');
  });

  it('falls back to id for unknown engine', () => {
    expect(getEngineLabel('ggml')).toBe('ggml');
  });

  it('handles empty string', () => {
    expect(getEngineLabel('')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// parseModelSizeBillions
// ---------------------------------------------------------------------------

describe('parseModelSizeBillions', () => {
  it.each([
    ['/models/llama-7b.gguf',        7],
    ['/models/codestral-22b.gguf',  22],
    ['/models/llama-3b.gguf',        3],
    ['/models/Qwen2.5-14B.gguf',    14],
    ['/models/Phi-4-mini',         null],
    ['/models/nosize',             null],
    ['',                           null],
  ])('parses %s → %s', (path, expected) => {
    expect(parseModelSizeBillions(path)).toBe(expected);
  });

  it('handles fractional sizes like 0.5b', () => {
    expect(parseModelSizeBillions('/models/phi-0.5b')).toBeCloseTo(0.5);
  });
});

// ---------------------------------------------------------------------------
// computeLayout
// ---------------------------------------------------------------------------

describe('computeLayout', () => {
  const roles = makeRoles(['architect', 'programmer', 'reviewer']);

  it('returns empty when nothing selected', () => {
    const layout = computeLayout(roles, new Set(), {}, ALL_MODELS);
    expect(layout).toHaveLength(0);
  });

  it('returns empty when selected but no models assigned', () => {
    const layout = computeLayout(roles, new Set(['architect']), {}, ALL_MODELS);
    expect(layout).toHaveLength(0);
  });

  it('groups agents sharing the same model on one port', () => {
    const selected = new Set(['architect', 'programmer']);
    const roleModels = {
      architect: '/models/llama-7b.gguf',
      programmer: '/models/llama-7b.gguf',
    };
    const layout = computeLayout(roles, selected, roleModels, ALL_MODELS);
    expect(layout).toHaveLength(1);
    expect(layout[0].agents).toContain('architect');
    expect(layout[0].agents).toContain('programmer');
    expect(layout[0].parallel).toBe(2);
  });

  it('splits agents on different models to different ports', () => {
    const selected = new Set(['architect', 'programmer']);
    const roleModels = {
      architect: '/models/llama-7b.gguf',
      programmer: '/models/codestral-22b.gguf',
    };
    const layout = computeLayout(roles, selected, roleModels, ALL_MODELS);
    expect(layout).toHaveLength(2);
    const ports = layout.map(l => l.port);
    expect(new Set(ports).size).toBe(2);
  });

  it('sets engine from model metadata', () => {
    const selected = new Set(['architect']);
    const roleModels = { architect: '/models/mlx-8b' };
    const layout = computeLayout(roles, selected, roleModels, ALL_MODELS);
    expect(layout[0].engine).toBe('mlx');
  });

  it('falls back to llama engine when model not in list', () => {
    const selected = new Set(['architect']);
    const roleModels = { architect: '/models/unknown-model.gguf' };
    const layout = computeLayout(roles, selected, roleModels, ALL_MODELS);
    expect(layout[0].engine).toBe('llama');
  });

  it('port numbers start at 8080 and increment', () => {
    const selected = new Set(['architect', 'programmer', 'reviewer']);
    const roleModels = {
      architect: '/models/llama-7b.gguf',
      programmer: '/models/codestral-22b.gguf',
      reviewer: '/models/llama-13b.gguf',
    };
    const layout = computeLayout(roles, selected, roleModels, ALL_MODELS);
    const ports = layout.map(l => l.port).sort((a, b) => a - b);
    expect(ports[0]).toBe(8080);
    expect(ports[1]).toBe(8081);
    expect(ports[2]).toBe(8082);
  });

  it('model label strips path and .gguf', () => {
    const selected = new Set(['architect']);
    const roleModels = { architect: '/models/codestral-22b.gguf' };
    const layout = computeLayout(roles, selected, roleModels, ALL_MODELS);
    expect(layout[0].model).toBe('codestral-22b');
  });

  it('handles 10 agents all on same model — one server with parallel=10', () => {
    const bigRoles = makeRoles([...Array(10).keys()].map(i => `agent${i}`));
    const selected = new Set(bigRoles.map(r => r.name));
    const roleModels = Object.fromEntries(bigRoles.map(r => [r.name, '/models/llama-7b.gguf']));
    const layout = computeLayout(bigRoles, selected, roleModels, ALL_MODELS);
    expect(layout).toHaveLength(1);
    expect(layout[0].parallel).toBe(10);
  });

  it('handles 10 agents each on a unique model — 10 servers', () => {
    const bigRoles = makeRoles([...Array(10).keys()].map(i => `role${i}`));
    const uniqueModels = bigRoles.map((r, i) => ({
      path: `/models/model${i}.gguf`, name: `Model${i}`, backend: 'llama',
    }));
    const selected = new Set(bigRoles.map(r => r.name));
    const roleModels = Object.fromEntries(bigRoles.map((r, i) => [r.name, uniqueModels[i].path]));
    const layout = computeLayout(bigRoles, selected, roleModels, [...ALL_MODELS, ...uniqueModels]);
    expect(layout).toHaveLength(10);
  });
});

// ---------------------------------------------------------------------------
// getProfileRoles
// ---------------------------------------------------------------------------

describe('getProfileRoles', () => {
  const allRoles = ['architect', 'programmer', 'reviewer', 'foreman', 'debugger'];
  const ctxMap = {
    architect: 4096,
    programmer: 2048,
    reviewer: 1024,
    foreman: 512,
    debugger: 8192,
  };

  it('safe profile filters to context <= 1024', () => {
    // Default safe threshold lowered to 1024 (M3 Max 36 GB memory tuning)
    const result = getProfileRoles(PROFILE_SAFE, allRoles, ctxMap, {});
    expect(result).toContain('reviewer');       // 1024 <= 1024
    expect(result).toContain('foreman');        // 512  <= 1024
    expect(result).not.toContain('programmer'); // 2048 > 1024
    expect(result).not.toContain('architect');  // 4096 > 1024
    expect(result).not.toContain('debugger');   // 8192 > 1024
  });

  it('balanced profile filters to context <= 2048', () => {
    // Default balanced threshold lowered to 2048
    const result = getProfileRoles(PROFILE_BALANCED, allRoles, ctxMap, {});
    expect(result).toContain('programmer');     // 2048 <= 2048
    expect(result).toContain('reviewer');
    expect(result).toContain('foreman');
    expect(result).not.toContain('architect');  // 4096 > 2048
    expect(result).not.toContain('debugger');   // 8192 > 2048
  });

  it('max profile filters to context <= 4096', () => {
    // Default max threshold now 4096 (was null); debugger exceeds it
    const result = getProfileRoles(PROFILE_MAX, allRoles, ctxMap, {});
    expect(result).toContain('architect');      // exactly 4096
    expect(result).toContain('programmer');
    expect(result).not.toContain('debugger');   // 8192 > 4096
  });

  it('mixed profile filters to context <= 3072', () => {
    // Default mixed threshold now 3072 (was null)
    const result = getProfileRoles(PROFILE_MIXED, allRoles, ctxMap, {});
    expect(result).toContain('programmer');     // 2048 <= 3072
    expect(result).not.toContain('architect');  // 4096 > 3072
    expect(result).not.toContain('debugger');   // 8192 > 3072
  });

  it('respects custom profileThresholds from config', () => {
    const thresholds = { safe: { max_context: 600 } };
    const result = getProfileRoles(PROFILE_SAFE, allRoles, ctxMap, thresholds);
    expect(result).toContain('foreman');    // 512 <= 600
    expect(result).not.toContain('reviewer'); // 1024 > 600
  });

  it('falls back to all roles when nothing passes filter', () => {
    const thresholds = { safe: { max_context: 100 } }; // nothing qualifies
    const result = getProfileRoles(PROFILE_SAFE, allRoles, ctxMap, thresholds);
    expect(result).toEqual(allRoles);
  });

  it('handles missing context entry — treated as 0', () => {
    const result = getProfileRoles(PROFILE_SAFE, ['unknown'], { unknown: undefined }, {});
    expect(result).toContain('unknown'); // 0 <= 2048
  });

  it('handles empty role list', () => {
    const result = getProfileRoles(PROFILE_MAX, [], ctxMap, {});
    expect(result).toEqual([]);
  });

  it('threshold max_context null means no filter', () => {
    const thresholds = { custom: { max_context: null } };
    const result = getProfileRoles('custom', allRoles, ctxMap, thresholds);
    expect(result).toEqual(allRoles);
  });
});

// ---------------------------------------------------------------------------
// chooseModelForRole
// ---------------------------------------------------------------------------

describe('chooseModelForRole', () => {
  it('returns null for empty model list', () => {
    expect(chooseModelForRole('architect', [])).toBeNull();
  });

  it('heavy roles (architect) get largest model', () => {
    const path = chooseModelForRole('architect', LLAMA_MODELS);
    expect(path).toBe('/models/codestral-22b.gguf'); // 22B is largest
  });

  it('light roles (foreman) get smallest model', () => {
    const path = chooseModelForRole('foreman', LLAMA_MODELS);
    expect(path).toBe('/models/llama-3b.gguf'); // 3B is smallest
  });

  it('programmer gets largest (heavy role)', () => {
    const path = chooseModelForRole('programmer', LLAMA_MODELS);
    expect(path).toBe('/models/codestral-22b.gguf');
  });

  it('reviewer gets largest (heavy role)', () => {
    const path = chooseModelForRole('reviewer', LLAMA_MODELS);
    expect(path).toBe('/models/codestral-22b.gguf');
  });

  it('single model list returns that model regardless of role', () => {
    const single = [LLAMA_MODELS[0]];
    expect(chooseModelForRole('architect', single)).toBe(LLAMA_MODELS[0].path);
    expect(chooseModelForRole('foreman', single)).toBe(LLAMA_MODELS[0].path);
  });

  it('breaks size ties alphabetically by name', () => {
    const twins = [
      { path: '/models/llama-b-7b.gguf', name: 'B', backend: 'llama' },
      { path: '/models/llama-a-7b.gguf', name: 'A', backend: 'llama' },
    ];
    // Both 7B — pick alphabetically smaller name for light role
    const path = chooseModelForRole('reporter', twins);
    expect(path).toBe('/models/llama-a-7b.gguf');
  });

  it('models with no parseable size use fallback sort', () => {
    const nosize = [
      { path: '/models/phi-mini', name: 'phi-mini', backend: 'llama' },
      { path: '/models/phi-pro',  name: 'phi-pro',  backend: 'llama' },
    ];
    // No size → heavy gets fallback sort 0 → first alphabetically; just check doesn't throw
    expect(() => chooseModelForRole('architect', nosize)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Stress: computeLayout with random agent/model combinations (100 runs)
// ---------------------------------------------------------------------------

describe('computeLayout stress — 100 random configurations', () => {
  const roleNames = ['a','b','c','d','e','f','g','h','i','j'];
  const roles = makeRoles(roleNames);
  const modelPaths = LLAMA_MODELS.map(m => m.path);

  it('never crashes and always produces consistent port assignment', () => {
    const failures = [];
    for (let i = 0; i < 100; i++) {
      const selectedSet = new Set(
        roleNames.filter(() => Math.random() > 0.4)
      );
      const roleModels = {};
      selectedSet.forEach(name => {
        if (Math.random() > 0.3) { // ~30% chance of no model assigned
          roleModels[name] = modelPaths[Math.floor(Math.random() * modelPaths.length)];
        }
      });

      let layout;
      try {
        layout = computeLayout(roles, selectedSet, roleModels, LLAMA_MODELS);
      } catch (err) {
        failures.push(`run ${i}: threw ${err.message}`);
        continue;
      }

      // All ports must be unique
      const ports = layout.map(l => l.port);
      if (new Set(ports).size !== ports.length) {
        failures.push(`run ${i}: duplicate ports ${ports}`);
      }

      // Agent count in layout must equal agents with models assigned
      const assigned = [...selectedSet].filter(n => roleModels[n]);
      const totalAgents = layout.reduce((s, l) => s + l.agents.length, 0);
      if (totalAgents !== assigned.length) {
        failures.push(`run ${i}: agent count mismatch ${totalAgents} vs ${assigned.length}`);
      }

      // Each port must start at >=8080
      for (const p of ports) {
        if (p < 8080) failures.push(`run ${i}: port ${p} < 8080`);
      }
    }
    expect(failures).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Stress: getProfileRoles with random context maps (100 runs)
// ---------------------------------------------------------------------------

describe('getProfileRoles stress — 100 random context maps', () => {
  const profiles = [PROFILE_SAFE, PROFILE_BALANCED, PROFILE_MAX, PROFILE_MIXED];
  const agents = ['a','b','c','d','e','f','g','h'];

  it('never returns empty when roles are available', () => {
    const failures = [];
    for (let i = 0; i < 100; i++) {
      const ctxMap = Object.fromEntries(
        agents.map(a => [a, Math.floor(Math.random() * 16384)])
      );
      for (const profile of profiles) {
        const result = getProfileRoles(profile, agents, ctxMap, {});
        if (result.length === 0) {
          failures.push(`run ${i} profile=${profile}: returned empty`);
        }
        if (!result.every(r => agents.includes(r))) {
          failures.push(`run ${i} profile=${profile}: result contains unknown roles`);
        }
      }
    }
    expect(failures).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Stress: chooseModelForRole with all roles × all model subsets
// ---------------------------------------------------------------------------

describe('chooseModelForRole stress — all role × model combinations', () => {
  const testRoles = ['architect','programmer','reviewer','foreman','debugger','reporter','analyst'];

  it('always returns a valid path or null', () => {
    const failures = [];
    for (let i = 0; i < 100; i++) {
      const subset = LLAMA_MODELS.filter(() => Math.random() > 0.5);
      for (const role of testRoles) {
        let result;
        try {
          result = chooseModelForRole(role, subset);
        } catch (err) {
          failures.push(`role=${role} run=${i}: threw ${err.message}`);
          continue;
        }
        if (subset.length === 0 && result !== null) {
          failures.push(`role=${role} run=${i}: expected null for empty list, got ${result}`);
        }
        if (subset.length > 0 && result !== null && !subset.map(m => m.path).includes(result)) {
          failures.push(`role=${role} run=${i}: result ${result} not in candidate list`);
        }
      }
    }
    expect(failures).toEqual([]);
  });
});
