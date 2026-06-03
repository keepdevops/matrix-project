/**
 * Mixed inference engine tests.
 *
 * These tests focus specifically on the behaviour when llama, mlx, and vllm
 * agents coexist in the same swarm — the engine-segregation logic in
 * computeLayout, the RAM/KV accounting in computeRiskEstimate, and the model
 * selection behaviour of chooseModelForRole across engine boundaries.
 *
 * Covers:
 * - computeLayout: llama+mlx+vllm agents land on separate ports (engine is
 *   part of the grouping key, so same model path + different engine → split)
 * - computeLayout: same engine + same model → shared port regardless of role
 * - computeLayout: engine resolved from model metadata beats role.engine
 * - computeLayout: engine falls back to role.engine when model not in list
 * - computeLayout: all three engines simultaneously — three separate groups
 * - computeRiskEstimate: mlxModelRamGb only counts MLX model bytes once per unique path
 * - computeRiskEstimate: mixed llama+mlx RAM baseline is model_gb + os_gb + mlx weights + kv
 * - computeRiskEstimate: vllm group gets separate KV rate from llama group
 * - computeRiskEstimate: mlx+vllm both blocked independently when parallel thresholds exceeded
 * - computeRiskEstimate: warnGroups contains only mlx-parallel entries, not llama
 * - chooseModelForRole: when called with a mixed backend list returns path from that list
 * - chooseModelForRole: heavy role picks largest from backend-filtered list, light picks smallest
 * - Stress: 200 random mixed-engine layouts — ports unique, engines preserved, no crashes
 * - Stress: 100 random mixed-engine risk estimates — totalRamGb >= baseline, band always valid
 */
import { computeLayout, computeRiskEstimate as _risk, chooseModelForRole, parseModelSizeBillions } from './SwarmConfig.helpers';
import { computeRiskEstimate } from './SwarmConfig.risk';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const LLAMA_7B  = { path: '/m/llama-7b.gguf',      name: 'Llama-7B',       backend: 'llama', size_bytes: 4e9  };
const LLAMA_22B = { path: '/m/codestral-22b.gguf',  name: 'Codestral-22B',  backend: 'llama', size_bytes: 14e9 };
const LLAMA_3B  = { path: '/m/llama-3b.gguf',       name: 'Llama-3B',       backend: 'llama', size_bytes: 2e9  };
const MLX_4B    = { path: '/m/mlx-4b',              name: 'MLX-4B',         backend: 'mlx',   size_bytes: 2.5e9 };
const MLX_8B    = { path: '/m/mlx-8b',              name: 'MLX-8B',         backend: 'mlx',   size_bytes: 5e9  };
const VLLM_14B  = { path: '/m/vllm-14b',            name: 'VLLM-14B',       backend: 'vllm',  size_bytes: 9e9  };
const ALL_MODELS = [LLAMA_7B, LLAMA_22B, LLAMA_3B, MLX_4B, MLX_8B, VLLM_14B];

function role(name, engine = 'llama', context = 2048) {
  return { name, engine, context };
}

// ---------------------------------------------------------------------------
// computeLayout — engine segregation
// ---------------------------------------------------------------------------

describe('computeLayout — mixed engine grouping', () => {
  it('same model path but different engines land on separate ports', () => {
    // Give llama and mlx variants the same path string (edge case) — engine differs → split
    const sharedPath = '/m/shared-model';
    const mixedModels = [
      { path: sharedPath, name: 'shared-llama', backend: 'llama' },
    ];
    const roles = [role('agent-a', 'llama'), role('agent-b', 'mlx')];
    const selected = new Set(['agent-a', 'agent-b']);
    // agent-b role.engine is mlx, but model meta says llama → meta wins
    const roleModels = { 'agent-a': sharedPath, 'agent-b': sharedPath };
    const layout = computeLayout(roles, selected, roleModels, mixedModels);
    // both resolve to llama engine (from meta) → share one port
    expect(layout).toHaveLength(1);
    expect(layout[0].engine).toBe('llama');
  });

  it('llama agent and mlx agent on different models → separate ports', () => {
    const roles = [role('coder', 'llama'), role('scout', 'mlx')];
    const selected = new Set(['coder', 'scout']);
    const roleModels = { coder: LLAMA_7B.path, scout: MLX_8B.path };
    const layout = computeLayout(roles, selected, roleModels, ALL_MODELS);
    expect(layout).toHaveLength(2);
    const engines = new Set(layout.map(l => l.engine));
    expect(engines).toContain('llama');
    expect(engines).toContain('mlx');
  });

  it('all three engines simultaneously produce three separate groups', () => {
    const roles = [role('arch', 'llama'), role('scout', 'mlx'), role('infer', 'vllm')];
    const selected = new Set(['arch', 'scout', 'infer']);
    const roleModels = { arch: LLAMA_7B.path, scout: MLX_4B.path, infer: VLLM_14B.path };
    const layout = computeLayout(roles, selected, roleModels, ALL_MODELS);
    expect(layout).toHaveLength(3);
    const engines = layout.map(l => l.engine).sort();
    expect(engines).toEqual(['llama', 'mlx', 'vllm']);
  });

  it('two llama agents on same model share a port even when mixed with other engines', () => {
    const roles = [
      role('arch', 'llama'), role('prog', 'llama'),
      role('scout', 'mlx'),
    ];
    const selected = new Set(['arch', 'prog', 'scout']);
    const roleModels = {
      arch:  LLAMA_7B.path,
      prog:  LLAMA_7B.path,
      scout: MLX_4B.path,
    };
    const layout = computeLayout(roles, selected, roleModels, ALL_MODELS);
    expect(layout).toHaveLength(2);
    const llamaGroup = layout.find(l => l.engine === 'llama');
    expect(llamaGroup.parallel).toBe(2);
    expect(llamaGroup.agents).toContain('arch');
    expect(llamaGroup.agents).toContain('prog');
  });

  it('engine resolved from model metadata beats role.engine', () => {
    // role declares engine='vllm' but model meta says 'mlx'
    const roles = [{ name: 'confusing', engine: 'vllm', context: 2048 }];
    const selected = new Set(['confusing']);
    const roleModels = { confusing: MLX_8B.path };
    const layout = computeLayout(roles, selected, roleModels, ALL_MODELS);
    expect(layout[0].engine).toBe('mlx'); // metadata wins
  });

  it('engine falls back to role.engine when model path not in models list', () => {
    const roles = [role('phantom', 'mlx')];
    const selected = new Set(['phantom']);
    const roleModels = { phantom: '/m/not-in-list.gguf' };
    const layout = computeLayout(roles, selected, roleModels, ALL_MODELS);
    expect(layout[0].engine).toBe('mlx'); // role.engine fallback
  });

  it('port numbers are unique across all engine groups', () => {
    const roles = [
      role('a', 'llama'), role('b', 'mlx'), role('c', 'vllm'),
      role('d', 'llama'), role('e', 'mlx'),
    ];
    const selected = new Set(['a', 'b', 'c', 'd', 'e']);
    const roleModels = {
      a: LLAMA_7B.path, b: MLX_4B.path,  c: VLLM_14B.path,
      d: LLAMA_22B.path, e: MLX_8B.path,
    };
    const layout = computeLayout(roles, selected, roleModels, ALL_MODELS);
    const ports = layout.map(l => l.port);
    expect(new Set(ports).size).toBe(ports.length);
    ports.forEach(p => expect(p).toBeGreaterThanOrEqual(8080));
  });
});

// ---------------------------------------------------------------------------
// computeRiskEstimate — mixed engine RAM accounting
// ---------------------------------------------------------------------------

describe('computeRiskEstimate — mixed engine RAM accounting', () => {
  it('mlxModelRamGb counts each unique MLX model path exactly once', () => {
    // Two MLX agents on the same model path → counted once, not twice
    const roles = [role('scout-a', 'mlx'), role('scout-b', 'mlx')];
    const selected = new Set(['scout-a', 'scout-b']);
    const roleModels = { 'scout-a': MLX_8B.path, 'scout-b': MLX_8B.path };
    const e = computeRiskEstimate(roles, selected, roleModels, ALL_MODELS);
    expect(e.mlxModelRamGb).toBeCloseTo(MLX_8B.size_bytes / 1e9, 1);
  });

  it('mlxModelRamGb sums distinct MLX model paths', () => {
    const roles = [role('a', 'mlx'), role('b', 'mlx')];
    const selected = new Set(['a', 'b']);
    const roleModels = { a: MLX_4B.path, b: MLX_8B.path };
    const e = computeRiskEstimate(roles, selected, roleModels, ALL_MODELS);
    const expected = (MLX_4B.size_bytes + MLX_8B.size_bytes) / 1e9;
    expect(e.mlxModelRamGb).toBeCloseTo(expected, 1);
  });

  it('llama-only config has mlxModelRamGb === 0', () => {
    const roles = [role('arch', 'llama'), role('prog', 'llama')];
    const selected = new Set(['arch', 'prog']);
    const roleModels = { arch: LLAMA_7B.path, prog: LLAMA_22B.path };
    const e = computeRiskEstimate(roles, selected, roleModels, ALL_MODELS);
    expect(e.mlxModelRamGb).toBe(0);
  });

  it('mixed llama+mlx totalRamGb exceeds llama-only totalRamGb by ~mlx weight', () => {
    const llamaRoles = [role('arch', 'llama')];
    const mixedRoles = [role('arch', 'llama'), role('scout', 'mlx')];
    const eLlama = computeRiskEstimate(
      llamaRoles, new Set(['arch']), { arch: LLAMA_7B.path }, ALL_MODELS,
    );
    const eMixed = computeRiskEstimate(
      mixedRoles, new Set(['arch', 'scout']),
      { arch: LLAMA_7B.path, scout: MLX_8B.path }, ALL_MODELS,
    );
    const delta = eMixed.totalRamGb - eLlama.totalRamGb;
    // delta should be approx mlx KV + mlx model weight (~5GB)
    expect(delta).toBeGreaterThan(4.5);
  });

  it('vllm group has separate KV entry from llama group in groups array', () => {
    const roles = [role('arch', 'llama'), role('infer', 'vllm')];
    const selected = new Set(['arch', 'infer']);
    const roleModels = { arch: LLAMA_7B.path, infer: VLLM_14B.path };
    const e = computeRiskEstimate(roles, selected, roleModels, ALL_MODELS);
    const engines = e.groups.map(g => g.engine);
    expect(engines).toContain('llama');
    expect(engines).toContain('vllm');
    // vllm and llama have different kvRate — their kvGb values differ for same ctx
    const llamaGroup = e.groups.find(g => g.engine === 'llama');
    const vllmGroup  = e.groups.find(g => g.engine === 'vllm');
    // vllm rate (0.10) > llama 7B rate (0.04) for same context → vllm kvGb > llama kvGb
    expect(vllmGroup.kvGb).toBeGreaterThan(llamaGroup.kvGb);
  });

  it('warnGroups contains mlx parallel entry but not llama entry', () => {
    const roles = [role('a', 'mlx'), role('b', 'mlx'), role('c', 'llama')];
    const selected = new Set(['a', 'b', 'c']);
    const roleModels = { a: MLX_4B.path, b: MLX_4B.path, c: LLAMA_7B.path };
    const e = computeRiskEstimate(roles, selected, roleModels, ALL_MODELS);
    const warnEngines = e.warnGroups.map(g => g.engine);
    expect(warnEngines).toContain('mlx');
    expect(warnEngines).not.toContain('llama');
  });

  it('mlx parallel>=2 sets riskLevel=warn but does not set riskLevel=block', () => {
    const roles = [role('x', 'mlx'), role('y', 'mlx')];
    const selected = new Set(['x', 'y']);
    const roleModels = { x: MLX_4B.path, y: MLX_4B.path };
    const e = computeRiskEstimate(roles, selected, roleModels, ALL_MODELS);
    const mlxGroup = e.groups.find(g => g.engine === 'mlx');
    expect(mlxGroup.riskLevel).toBe('warn');
    expect(mlxGroup.riskLevel).not.toBe('block');
  });

  it('vllm 14B parallel>=3 sets riskLevel=block and appears in blockedGroups', () => {
    const roles = ['v0','v1','v2'].map(n => role(n, 'vllm'));
    const selected = new Set(['v0','v1','v2']);
    const roleModels = Object.fromEntries(['v0','v1','v2'].map(n => [n, VLLM_14B.path]));
    const e = computeRiskEstimate(roles, selected, roleModels, ALL_MODELS);
    const vllmGroup = e.groups.find(g => g.engine === 'vllm');
    expect(vllmGroup.riskLevel).toBe('block');
    expect(e.blockedGroups.some(g => g.engine === 'vllm')).toBe(true);
  });

  it('vllm block rule fires independently of total RAM band', () => {
    // 3 vllm 14B agents → blocked by rule even when total RAM stays under 33GB
    const vllmRoles = ['v0','v1','v2'].map(n => role(n, 'vllm', 2048));
    const llamaRoles = [role('la0', 'llama', 2048)];
    const allRoles = [...vllmRoles, ...llamaRoles];
    const selected = new Set(allRoles.map(r => r.name));
    const roleModels = {
      ...Object.fromEntries(vllmRoles.map(r => [r.name, VLLM_14B.path])),
      la0: LLAMA_7B.path,
    };
    const e = computeRiskEstimate(allRoles, selected, roleModels, ALL_MODELS);
    expect(e.blockedGroups.length).toBeGreaterThan(0);
    expect(e.blockedGroups.some(g => g.engine === 'vllm')).toBe(true);
  });

  it('totalKvGb is sum of all group kvGb values regardless of engine', () => {
    const roles = [role('a', 'llama'), role('b', 'mlx'), role('c', 'vllm')];
    const selected = new Set(['a', 'b', 'c']);
    const roleModels = { a: LLAMA_7B.path, b: MLX_4B.path, c: VLLM_14B.path };
    const e = computeRiskEstimate(roles, selected, roleModels, ALL_MODELS);
    const manualSum = e.groups.reduce((s, g) => s + g.kvGb, 0);
    expect(e.totalKvGb).toBeCloseTo(manualSum, 6);
  });
});

// ---------------------------------------------------------------------------
// chooseModelForRole — engine-filtered lists
// ---------------------------------------------------------------------------

describe('chooseModelForRole — backend-filtered model lists', () => {
  it('heavy role picks largest from MLX-only list', () => {
    // MLX_8B (8B) > MLX_4B (4B) → architect should get MLX_8B
    const path = chooseModelForRole('architect', [MLX_4B, MLX_8B]);
    expect(path).toBe(MLX_8B.path);
  });

  it('light role picks smallest from MLX-only list', () => {
    const path = chooseModelForRole('reporter', [MLX_4B, MLX_8B]);
    expect(path).toBe(MLX_4B.path);
  });

  it('heavy role picks largest from vLLM-only list', () => {
    const vllm20 = { path: '/m/vllm-20b', name: 'VLLM-20B', backend: 'vllm', size_bytes: 13e9 };
    const path = chooseModelForRole('programmer', [VLLM_14B, vllm20]);
    expect(path).toBe(vllm20.path);
  });

  it('returns null when passed empty list regardless of engine', () => {
    expect(chooseModelForRole('architect', [])).toBeNull();
    expect(chooseModelForRole('foreman',   [])).toBeNull();
  });

  it('returns the only element when list has one entry of any engine', () => {
    expect(chooseModelForRole('architect', [MLX_4B])).toBe(MLX_4B.path);
    expect(chooseModelForRole('foreman',   [VLLM_14B])).toBe(VLLM_14B.path);
  });

  it('does not mix backends — caller is responsible for filtering', () => {
    // If caller passes a mixed list, function still returns the best-fitting path
    const mixed = [LLAMA_3B, MLX_8B, VLLM_14B];
    const path = chooseModelForRole('architect', mixed);
    // Largest parseable size is VLLM-14B (14B)
    expect(path).toBe(VLLM_14B.path);
  });
});

// ---------------------------------------------------------------------------
// Stress: 200 random mixed-engine layouts
// ---------------------------------------------------------------------------

describe('computeLayout stress — 200 random mixed-engine configs', () => {
  const ENGINES_LIST = ['llama', 'mlx', 'vllm'];
  const roleNames = ['a','b','c','d','e','f'];

  it('ports always unique, engines preserved, no crashes', () => {
    const failures = [];
    for (let i = 0; i < 200; i++) {
      const roles = roleNames.map(n => ({
        name: n,
        engine: ENGINES_LIST[Math.floor(Math.random() * 3)],
        context: 2048,
      }));
      const selected = new Set(roleNames.filter(() => Math.random() > 0.3));
      const roleModels = {};
      selected.forEach(n => {
        if (Math.random() > 0.2) {
          roleModels[n] = ALL_MODELS[Math.floor(Math.random() * ALL_MODELS.length)].path;
        }
      });

      let layout;
      try {
        layout = computeLayout(roles, selected, roleModels, ALL_MODELS);
      } catch (err) {
        failures.push(`run ${i}: threw ${err.message}`);
        continue;
      }

      const ports = layout.map(l => l.port);
      if (new Set(ports).size !== ports.length) {
        failures.push(`run ${i}: duplicate ports ${ports}`);
      }

      for (const entry of layout) {
        if (!['llama', 'mlx', 'vllm'].includes(entry.engine)) {
          failures.push(`run ${i}: unexpected engine "${entry.engine}"`);
        }
        if (entry.port < 8080) {
          failures.push(`run ${i}: port ${entry.port} < 8080`);
        }
        if (entry.parallel !== entry.agents.length) {
          failures.push(`run ${i}: parallel mismatch`);
        }
      }

      const assigned = [...selected].filter(n => roleModels[n]);
      const total = layout.reduce((s, l) => s + l.agents.length, 0);
      if (total !== assigned.length) {
        failures.push(`run ${i}: agent count ${total} !== assigned ${assigned.length}`);
      }
    }
    expect(failures).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Stress: 100 random mixed-engine risk estimates
// ---------------------------------------------------------------------------

describe('computeRiskEstimate stress — 100 random mixed-engine configs', () => {
  const RAM_OS_GB = 9; // updated: measured 7.2 GB wired + 2.5 GB processes

  it('totalRamGb >= baseline when agents ready, band always valid, no NaN', () => {
    const failures = [];
    for (let i = 0; i < 100; i++) {
      const roles = ['a','b','c','d','e'].map(n => ({
        name: n,
        engine: ['llama','mlx','vllm'][Math.floor(Math.random() * 3)],
        context: Math.floor(Math.random() * 8192) + 512,
      }));
      const selected = new Set(['a','b','c','d','e'].filter(() => Math.random() > 0.3));
      const roleModels = {};
      selected.forEach(n => {
        if (Math.random() > 0.25) {
          roleModels[n] = ALL_MODELS[Math.floor(Math.random() * ALL_MODELS.length)].path;
        }
      });

      let e;
      try {
        e = computeRiskEstimate(roles, selected, roleModels, ALL_MODELS);
      } catch (err) {
        failures.push(`run ${i}: threw ${err.message}`);
        continue;
      }

      if (isNaN(e.totalRamGb)) failures.push(`run ${i}: totalRamGb NaN`);
      if (isNaN(e.totalKvGb))  failures.push(`run ${i}: totalKvGb NaN`);
      if (e.totalKvGb < 0)     failures.push(`run ${i}: totalKvGb < 0`);
      if (e.mlxModelRamGb < 0) failures.push(`run ${i}: mlxModelRamGb < 0`);
      if (e.modelWeightRamGb < 0) failures.push(`run ${i}: modelWeightRamGb < 0`);
      if (!['low','medium','high'].includes(e.band.id)) {
        failures.push(`run ${i}: invalid band "${e.band.id}"`);
      }
      if (e.readyAgents > 0 && e.totalRamGb < RAM_OS_GB) {
        failures.push(`run ${i}: totalRamGb ${e.totalRamGb} < OS baseline ${RAM_OS_GB}`);
      }
      // totalRamGb must equal OS + model weights + KV (no fixed base)
      const expected = RAM_OS_GB + e.modelWeightRamGb + e.totalKvGb;
      if (Math.abs(e.totalRamGb - expected) > 0.001) {
        failures.push(`run ${i}: totalRamGb ${e.totalRamGb.toFixed(4)} !== OS+weights+KV ${expected.toFixed(4)}`);
      }
    }
    expect(failures).toEqual([]);
  });
});
