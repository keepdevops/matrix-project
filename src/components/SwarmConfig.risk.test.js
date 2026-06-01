import { computeRiskEstimate } from './SwarmConfig.risk';

const RAM_OS_GB = 4;
// New formula: OS + model_weight_estimate + KV + mode_overhead (no fixed RAM_MODEL_GB base)

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MODELS = [
  { path: '/m/llama-3b.gguf',      name: 'Llama-3B',      backend: 'llama', size_bytes: 2e9  },
  { path: '/m/llama-7b.gguf',      name: 'Llama-7B',      backend: 'llama', size_bytes: 4e9  },
  { path: '/m/codestral-22b.gguf', name: 'Codestral-22B', backend: 'llama', size_bytes: 14e9 },
  { path: '/m/mlx-4b',             name: 'MLX-4B',        backend: 'mlx',   size_bytes: 2.5e9 },
  { path: '/m/mlx-8b',             name: 'MLX-8B',        backend: 'mlx',   size_bytes: 5e9  },
  { path: '/m/vllm-14b',           name: 'VLLM-14B',      backend: 'vllm',  size_bytes: 9e9  },
];

function makeRole(name, context = 2048, engine = 'llama') {
  return { name, context, engine };
}

// ---------------------------------------------------------------------------
// Basic correctness
// ---------------------------------------------------------------------------

describe('computeRiskEstimate — basics', () => {
  it('returns 0 ready agents when nothing selected', () => {
    const e = computeRiskEstimate(
      [makeRole('architect')],
      new Set(),
      {},
      MODELS,
    );
    expect(e.readyAgents).toBe(0);
  });

  it('returns 0 ready agents when selected but no model assigned', () => {
    const e = computeRiskEstimate(
      [makeRole('architect')],
      new Set(['architect']),
      {},
      MODELS,
    );
    expect(e.readyAgents).toBe(0);
  });

  it('counts only agents with models assigned', () => {
    const roles = [makeRole('architect'), makeRole('programmer')];
    const e = computeRiskEstimate(
      roles,
      new Set(['architect', 'programmer']),
      { architect: '/m/llama-7b.gguf' }, // programmer has no model
      MODELS,
    );
    expect(e.readyAgents).toBe(1);
  });

  it('low risk for small model with small context', () => {
    const e = computeRiskEstimate(
      [makeRole('foreman', 512)],
      new Set(['foreman']),
      { foreman: '/m/llama-3b.gguf' },
      MODELS,
    );
    expect(e.band.id).toBe('low');
  });

  it('totalRamGb includes model + OS base + KV cache', () => {
    const e = computeRiskEstimate(
      [makeRole('reviewer', 2048)],
      new Set(['reviewer']),
      { reviewer: '/m/llama-7b.gguf' },
      MODELS,
    );
    // llama-7b size_bytes=4GB, OS=4GB → baseline ≥ 8GB before KV
    expect(e.totalRamGb).toBeGreaterThan(RAM_OS_GB + 3.5);
    expect(e.modelWeightRamGb).toBeCloseTo(4.0, 1);
  });

  it('totalKvGb is positive when agents are ready', () => {
    const e = computeRiskEstimate(
      [makeRole('architect', 4096)],
      new Set(['architect']),
      { architect: '/m/codestral-22b.gguf' },
      MODELS,
    );
    expect(e.totalKvGb).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Risk band transitions
// ---------------------------------------------------------------------------

describe('computeRiskEstimate — risk bands', () => {
  it('high risk when totalRamGb > 33', () => {
    // 3 separate model groups: codestral-22b(14GB) + mlx-8b(5GB) + vllm-14b(9GB) = 28GB weights
    // + OS 4GB + KV ≈ 7GB = ~39GB > 33.12 threshold
    const roles = [
      ...Array.from({ length: 4 }, (_, i) => makeRole(`c${i}`, 8192, 'llama')),
      ...Array.from({ length: 3 }, (_, i) => makeRole(`m${i}`, 8192, 'mlx')),
      ...Array.from({ length: 3 }, (_, i) => makeRole(`v${i}`, 8192, 'vllm')),
    ];
    const selected = new Set(roles.map(r => r.name));
    const roleModels = {
      ...Object.fromEntries(roles.filter(r => r.engine === 'llama').map(r => [r.name, '/m/codestral-22b.gguf'])),
      ...Object.fromEntries(roles.filter(r => r.engine === 'mlx').map(r => [r.name, '/m/mlx-8b'])),
      ...Object.fromEntries(roles.filter(r => r.engine === 'vllm').map(r => [r.name, '/m/vllm-14b'])),
    };
    const e = computeRiskEstimate(roles, selected, roleModels, MODELS);
    expect(e.band.id).toBe('high');
  });

  it('block when totalRamGb > 33 — blockedGroups non-empty', () => {
    const roles = [
      ...Array.from({ length: 4 }, (_, i) => makeRole(`c${i}`, 8192, 'llama')),
      ...Array.from({ length: 3 }, (_, i) => makeRole(`m${i}`, 8192, 'mlx')),
      ...Array.from({ length: 3 }, (_, i) => makeRole(`v${i}`, 8192, 'vllm')),
    ];
    const selected = new Set(roles.map(r => r.name));
    const roleModels = {
      ...Object.fromEntries(roles.filter(r => r.engine === 'llama').map(r => [r.name, '/m/codestral-22b.gguf'])),
      ...Object.fromEntries(roles.filter(r => r.engine === 'mlx').map(r => [r.name, '/m/mlx-8b'])),
      ...Object.fromEntries(roles.filter(r => r.engine === 'vllm').map(r => [r.name, '/m/vllm-14b'])),
    };
    const e = computeRiskEstimate(roles, selected, roleModels, MODELS);
    expect(e.blockedGroups.length).toBeGreaterThan(0);
  });

  it('medium risk in the warn zone (78-92% of 36GB)', () => {
    // codestral-22b(14GB) + vllm-14b(9GB) = 23GB weights + OS 4GB + KV ≈ 3GB = ~30GB → medium
    const roles = [
      ...Array.from({ length: 2 }, (_, i) => makeRole(`c${i}`, 8192, 'llama')),
      ...Array.from({ length: 2 }, (_, i) => makeRole(`v${i}`, 8192, 'vllm')),
    ];
    const selected = new Set(roles.map(r => r.name));
    const roleModels = {
      ...Object.fromEntries(roles.filter(r => r.engine === 'llama').map(r => [r.name, '/m/codestral-22b.gguf'])),
      ...Object.fromEntries(roles.filter(r => r.engine === 'vllm').map(r => [r.name, '/m/vllm-14b'])),
    };
    const e = computeRiskEstimate(roles, selected, roleModels, MODELS);
    expect(['medium', 'high']).toContain(e.band.id);
  });
});

// ---------------------------------------------------------------------------
// MLX / vLLM specific warnings
// ---------------------------------------------------------------------------

describe('computeRiskEstimate — engine warnings', () => {
  it('warns on MLX with parallel >= 2', () => {
    const roles = [makeRole('a', 2048, 'mlx'), makeRole('b', 2048, 'mlx')];
    const selected = new Set(['a', 'b']);
    const roleModels = { a: '/m/mlx-8b', b: '/m/mlx-8b' };
    const e = computeRiskEstimate(roles, selected, roleModels, MODELS);
    const mlxGroup = e.groups.find(g => g.engine === 'mlx');
    expect(mlxGroup?.warnings.length).toBeGreaterThan(0);
    expect(mlxGroup?.warnings[0]).toMatch(/MLX/);
    expect(mlxGroup?.warnings[0]).toMatch(/serializes/);
  });

  it('MLX warning text mentions latency', () => {
    const roles = [makeRole('p', 2048, 'mlx'), makeRole('q', 2048, 'mlx')];
    const selected = new Set(['p', 'q']);
    const roleModels = { p: '/m/mlx-4b', q: '/m/mlx-4b' };
    const e = computeRiskEstimate(roles, selected, roleModels, MODELS);
    const mlxGroup = e.groups.find(g => g.engine === 'mlx');
    expect(mlxGroup.warnings[0]).toMatch(/latency/i);
  });

  it('no MLX warning for single MLX agent', () => {
    const roles = [makeRole('solo', 2048, 'mlx')];
    const selected = new Set(['solo']);
    const roleModels = { solo: '/m/mlx-4b' };
    const e = computeRiskEstimate(roles, selected, roleModels, MODELS);
    const mlxGroup = e.groups.find(g => g.engine === 'mlx');
    expect(mlxGroup?.warnings ?? []).toHaveLength(0);
  });

  it('MLX model weights included in totalRamGb', () => {
    const roles = [makeRole('scout', 2048, 'mlx')];
    const selected = new Set(['scout']);
    const roleModels = { scout: '/m/mlx-8b' };
    const e = computeRiskEstimate(roles, selected, roleModels, MODELS);
    // mlx-8b size_bytes=5GB — must appear in mlxModelRamGb, modelWeightRamGb, and totalRamGb
    expect(e.mlxModelRamGb).toBeCloseTo(5.0, 1);
    expect(e.modelWeightRamGb).toBeCloseTo(5.0, 1);
    expect(e.totalRamGb).toBeGreaterThan(RAM_OS_GB + 4.9);
  });

  it('mixed llama+MLX: MLX weight stacks on top of llama weight', () => {
    const roles = [makeRole('coder', 2048, 'llama'), makeRole('scout', 2048, 'mlx')];
    const selected = new Set(['coder', 'scout']);
    const roleModels = { coder: '/m/llama-7b.gguf', scout: '/m/mlx-8b' };
    const eLlama = computeRiskEstimate([makeRole('coder', 2048, 'llama')], new Set(['coder']), { coder: '/m/llama-7b.gguf' }, MODELS);
    const eMixed = computeRiskEstimate(roles, selected, roleModels, MODELS);
    // Adding MLX-8B (5GB) should increase totalRamGb by ~5GB
    expect(eMixed.totalRamGb).toBeGreaterThan(eLlama.totalRamGb + 4.9);
  });

  it('MLX model with no size_bytes contributes 0 to mlxModelRamGb', () => {
    const noSizeModels = MODELS.map(m => m.backend === 'mlx' ? { ...m, size_bytes: 0 } : m);
    const roles = [makeRole('scout', 2048, 'mlx')];
    const selected = new Set(['scout']);
    const roleModels = { scout: '/m/mlx-8b' };
    const e = computeRiskEstimate(roles, selected, roleModels, noSizeModels);
    expect(e.mlxModelRamGb).toBe(0);
  });

  it('blocks vLLM 14B with parallel >= 3', () => {
    const roles = Array.from({ length: 3 }, (_, i) => makeRole(`v${i}`, 2048, 'vllm'));
    const selected = new Set(roles.map(r => r.name));
    const roleModels = Object.fromEntries(roles.map(r => [r.name, '/m/vllm-14b']));
    const e = computeRiskEstimate(roles, selected, roleModels, MODELS);
    const vllmGroup = e.groups.find(g => g.engine === 'vllm');
    expect(vllmGroup?.riskLevel).toBe('block');
    expect(e.blockedGroups.length).toBeGreaterThan(0);
    expect(e.blockedGroups[0].engine).toBe('vllm');
    expect(e.blockedGroups[0].warnings[0]).toMatch(/vLLM/);
  });

  it('high RAM band hint text mentions OOM', () => {
    const roles = [
      ...Array.from({ length: 4 }, (_, i) => makeRole(`c${i}`, 8192, 'llama')),
      ...Array.from({ length: 3 }, (_, i) => makeRole(`m${i}`, 8192, 'mlx')),
      ...Array.from({ length: 3 }, (_, i) => makeRole(`v${i}`, 8192, 'vllm')),
    ];
    const selected = new Set(roles.map(r => r.name));
    const roleModels = {
      ...Object.fromEntries(roles.filter(r => r.engine === 'llama').map(r => [r.name, '/m/codestral-22b.gguf'])),
      ...Object.fromEntries(roles.filter(r => r.engine === 'mlx').map(r => [r.name, '/m/mlx-8b'])),
      ...Object.fromEntries(roles.filter(r => r.engine === 'vllm').map(r => [r.name, '/m/vllm-14b'])),
    };
    const e = computeRiskEstimate(roles, selected, roleModels, MODELS);
    expect(e.band.id).toBe('high');
    expect(e.band.hint).toMatch(/OOM/i);
  });

  it('medium RAM band hint text mentions pressure or slowdown', () => {
    const roles = Array.from({ length: 8 }, (_, i) => makeRole(`b${i}`, 8192));
    const selected = new Set(roles.map(r => r.name));
    const roleModels = Object.fromEntries(roles.map(r => [r.name, '/m/codestral-22b.gguf']));
    const e = computeRiskEstimate(roles, selected, roleModels, MODELS);
    if (e.band.id === 'medium') {
      expect(e.band.hint).toMatch(/pressure|slowdown/i);
    }
  });
});

// ---------------------------------------------------------------------------
// Groups structure
// ---------------------------------------------------------------------------

describe('computeRiskEstimate — groups', () => {
  it('groups agents sharing same model into one group', () => {
    const roles = [makeRole('arch'), makeRole('prog')];
    const selected = new Set(['arch', 'prog']);
    const roleModels = { arch: '/m/llama-7b.gguf', prog: '/m/llama-7b.gguf' };
    const e = computeRiskEstimate(roles, selected, roleModels, MODELS);
    expect(e.groups).toHaveLength(1);
    expect(e.groups[0].parallel).toBe(2);
  });

  it('splits agents on different models into separate groups', () => {
    const roles = [makeRole('arch'), makeRole('prog')];
    const selected = new Set(['arch', 'prog']);
    const roleModels = { arch: '/m/llama-7b.gguf', prog: '/m/codestral-22b.gguf' };
    const e = computeRiskEstimate(roles, selected, roleModels, MODELS);
    expect(e.groups).toHaveLength(2);
  });

  it('groups sorted by kvGb descending', () => {
    const roles = [makeRole('small', 512), makeRole('big', 8192)];
    const selected = new Set(['small', 'big']);
    const roleModels = {
      small: '/m/llama-3b.gguf',
      big: '/m/codestral-22b.gguf',
    };
    const e = computeRiskEstimate(roles, selected, roleModels, MODELS);
    expect(e.groups[0].kvGb).toBeGreaterThanOrEqual(e.groups[1].kvGb);
  });
});

// ---------------------------------------------------------------------------
// Stress: 100 random configs — invariants always hold
// ---------------------------------------------------------------------------

describe('computeRiskEstimate stress — 100 random configurations', () => {
  const roleNames = ['a','b','c','d','e','f','g','h'];
  const modelPaths = MODELS.map(m => m.path);

  it('totalRamGb and totalKvGb are consistent, band is always set', () => {
    const failures = [];

    for (let i = 0; i < 100; i++) {
      const roles = roleNames.map(n => ({
        name: n,
        context: Math.floor(Math.random() * 8192) + 512,
        engine: ['llama','mlx','vllm'][Math.floor(Math.random() * 3)],
      }));
      const selected = new Set(roleNames.filter(() => Math.random() > 0.4));
      const roleModels = {};
      selected.forEach(n => {
        if (Math.random() > 0.3) {
          roleModels[n] = modelPaths[Math.floor(Math.random() * modelPaths.length)];
        }
      });

      let e;
      try {
        e = computeRiskEstimate(roles, selected, roleModels, MODELS);
      } catch (err) {
        failures.push(`run ${i}: threw ${err.message}`);
        continue;
      }

      if (typeof e.totalRamGb !== 'number' || isNaN(e.totalRamGb)) {
        failures.push(`run ${i}: totalRamGb is NaN`);
      }
      if (e.totalKvGb < 0) {
        failures.push(`run ${i}: totalKvGb < 0`);
      }
      if (!['low','medium','high'].includes(e.band.id)) {
        failures.push(`run ${i}: invalid band ${e.band.id}`);
      }
      if (e.readyAgents < 0) {
        failures.push(`run ${i}: readyAgents < 0`);
      }
      // Sanity: totalRamGb >= OS overhead when agents are ready
      if (e.readyAgents > 0 && e.totalRamGb < RAM_OS_GB) {
        failures.push(`run ${i}: totalRamGb ${e.totalRamGb} < OS baseline ${RAM_OS_GB}`);
      }
    }

    expect(failures).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Stress: role count sweep — 1 to 20 agents
// ---------------------------------------------------------------------------

describe('computeRiskEstimate stress — role count sweep 1-20', () => {
  it('RAM estimate increases monotonically as agents and context grow', () => {
    const model = '/m/llama-7b.gguf';
    let prevRam = 0;

    for (let n = 1; n <= 20; n++) {
      const roles = Array.from({ length: n }, (_, i) => makeRole(`r${i}`, 2048));
      const selected = new Set(roles.map(r => r.name));
      const roleModels = Object.fromEntries(roles.map(r => [r.name, model]));
      const e = computeRiskEstimate(roles, selected, roleModels, MODELS);

      expect(e.totalRamGb).toBeGreaterThanOrEqual(prevRam);
      prevRam = e.totalRamGb;
    }
  });
});

// ---------------------------------------------------------------------------
// Chaos monkey: poisoned inputs — never throws, invariants hold
// ---------------------------------------------------------------------------

describe('computeRiskEstimate chaos — poisoned roles and models', () => {
  it('roles with zero/negative context never produce NaN', () => {
    const failures = [];
    const badContexts = [0, -1, -8192, NaN, Infinity, null, undefined, 'big', []];
    for (const ctx of badContexts) {
      const roles = [{ name: 'x', context: ctx, engine: 'llama' }];
      let e;
      try {
        e = computeRiskEstimate(roles, new Set(['x']), { x: '/m/llama-7b.gguf' }, MODELS);
      } catch (err) {
        failures.push(`ctx=${ctx}: threw ${err.message}`);
        continue;
      }
      if (isNaN(e.totalRamGb)) failures.push(`ctx=${ctx}: totalRamGb is NaN`);
      if (isNaN(e.totalKvGb))  failures.push(`ctx=${ctx}: totalKvGb is NaN`);
    }
    expect(failures).toEqual([]);
  });

  it('unknown model path produces valid estimate (no crash)', () => {
    const roles = [makeRole('x', 2048, 'llama')];
    const e = computeRiskEstimate(roles, new Set(['x']), { x: '/m/does-not-exist.gguf' }, MODELS);
    expect(typeof e.totalRamGb).toBe('number');
    expect(isNaN(e.totalRamGb)).toBe(false);
  });

  it('models array is empty — estimate still returns valid shape', () => {
    const roles = [makeRole('a', 2048, 'llama'), makeRole('b', 2048, 'mlx')];
    const selected = new Set(['a', 'b']);
    const roleModels = { a: '/m/llama-7b.gguf', b: '/m/mlx-8b' };
    const e = computeRiskEstimate(roles, selected, roleModels, []);
    expect(e.mlxModelRamGb).toBe(0);
    expect(typeof e.totalRamGb).toBe('number');
  });

  it('roles is empty array — returns zero agents, low band', () => {
    const e = computeRiskEstimate([], new Set(), {}, MODELS);
    expect(e.readyAgents).toBe(0);
    expect(e.band.id).toBe('low');
    expect(e.groups).toHaveLength(0);
  });

  it('selected Set contains names not in roles — no crash', () => {
    const roles = [makeRole('known', 2048)];
    const e = computeRiskEstimate(
      roles, new Set(['known', 'ghost', 'phantom']),
      { known: '/m/llama-7b.gguf', ghost: '/m/llama-7b.gguf' },
      MODELS,
    );
    expect(e.readyAgents).toBe(1);
  });

  it('roleModels maps to model paths with size_bytes=0 — mlxModelRamGb stays 0', () => {
    const zeroModels = [{ path: '/m/mlx-zero', name: 'MLX-zero', backend: 'mlx', size_bytes: 0 }];
    const roles = [{ name: 'x', context: 2048, engine: 'mlx' }];
    const e = computeRiskEstimate(roles, new Set(['x']), { x: '/m/mlx-zero' }, zeroModels);
    expect(e.mlxModelRamGb).toBe(0);
    expect(isNaN(e.totalRamGb)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Chaos monkey: 100 random mixed-backend configs — MLX weight always counted
// ---------------------------------------------------------------------------

describe('computeRiskEstimate chaos — 100 random mixed-backend configs', () => {
  const roleNames = ['a','b','c','d','e','f'];
  const modelPaths = MODELS.map(m => m.path);

  it('mlxModelRamGb always matches sum of assigned MLX model size_bytes', () => {
    const failures = [];

    for (let i = 0; i < 100; i++) {
      const roles = roleNames.map(n => ({
        name: n,
        context: Math.floor(Math.random() * 4096) + 512,
        engine: ['llama','mlx','vllm'][Math.floor(Math.random() * 3)],
      }));
      const selected = new Set(roleNames.filter(() => Math.random() > 0.3));
      const roleModels = {};
      selected.forEach(n => {
        if (Math.random() > 0.2) {
          roleModels[n] = modelPaths[Math.floor(Math.random() * modelPaths.length)];
        }
      });

      let e;
      try {
        e = computeRiskEstimate(roles, selected, roleModels, MODELS);
      } catch (err) {
        failures.push(`run ${i}: threw ${err.message}`);
        continue;
      }

      // Manually compute expected mlxModelRamGb
      const seenPaths = new Set();
      let expectedMlxGb = 0;
      for (const role of roles) {
        if (!selected.has(role.name)) continue;
        const path = roleModels[role.name];
        if (!path) continue;
        const meta = MODELS.find(m => m.path === path);
        if (meta?.backend === 'mlx' && meta.size_bytes > 0 && !seenPaths.has(path)) {
          seenPaths.add(path);
          expectedMlxGb += meta.size_bytes / 1e9;
        }
      }

      if (Math.abs(e.mlxModelRamGb - expectedMlxGb) > 0.01) {
        failures.push(`run ${i}: mlxModelRamGb=${e.mlxModelRamGb} expected=${expectedMlxGb}`);
      }
      if (isNaN(e.totalRamGb) || e.totalRamGb < 0) {
        failures.push(`run ${i}: totalRamGb=${e.totalRamGb}`);
      }
    }
    expect(failures).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// MS-25-4: Python mode overhead
// ---------------------------------------------------------------------------

describe('computeRiskEstimate — activeMode overhead', () => {
  const roles = [makeRole('architect'), makeRole('programmer')];
  const selected = new Set(['architect', 'programmer']);
  const roleModels = { architect: '/m/llama-7b.gguf', programmer: '/m/llama-7b.gguf' };

  it('adds zero overhead for cpp modes (weight=1)', () => {
    const base = computeRiskEstimate(roles, selected, roleModels, MODELS, null, null);
    const flat = computeRiskEstimate(roles, selected, roleModels, MODELS, null, 'flat');
    expect(flat.modeOverheadGb).toBeCloseTo(0, 5);
    expect(flat.totalRamGb).toBeCloseTo(base.totalRamGb, 5);
  });

  it('adds (weight-1)×1.5 GB overhead for Python modes', () => {
    const mapR = computeRiskEstimate(roles, selected, roleModels, MODELS, null, 'map_reduce');
    expect(mapR.modeOverheadGb).toBeCloseTo(3.0, 5);
    expect(mapR.activeMode).toBe('map_reduce');
    const spec = computeRiskEstimate(roles, selected, roleModels, MODELS, null, 'speculative');
    expect(spec.modeOverheadGb).toBeCloseTo(1.5, 5);
  });

  it('reflects mode overhead in totalRamGb', () => {
    const base = computeRiskEstimate(roles, selected, roleModels, MODELS, null, null);
    const heavy = computeRiskEstimate(roles, selected, roleModels, MODELS, null, 'map_reduce');
    expect(heavy.totalRamGb).toBeCloseTo(base.totalRamGb + 3.0, 4);
  });

  it('blocks when mode overhead pushes past block threshold', () => {
    // codestral-22b(14GB) + vllm-14b(9GB) = 23GB weights + OS 4GB = 27GB base
    // map_reduce overhead +3GB → 30GB → MEDIUM; add large KV to push to HIGH
    const manyRoles = [
      ...Array.from({ length: 3 }, (_, i) => makeRole(`c${i}`, 16384, 'llama')),
      ...Array.from({ length: 3 }, (_, i) => makeRole(`v${i}`, 16384, 'vllm')),
    ];
    const selected = new Set(manyRoles.map(r => r.name));
    const roleModels = {
      ...Object.fromEntries(manyRoles.filter(r => r.engine === 'llama').map(r => [r.name, '/m/codestral-22b.gguf'])),
      ...Object.fromEntries(manyRoles.filter(r => r.engine === 'vllm').map(r => [r.name, '/m/vllm-14b'])),
    };
    const e = computeRiskEstimate(manyRoles, selected, roleModels, MODELS, null, 'map_reduce');
    expect(e.modeOverheadGb).toBeCloseTo(3.0, 4);
    expect(e.totalRamGb).toBeGreaterThan(e.totalRamGb - e.modeOverheadGb);
  });
});
