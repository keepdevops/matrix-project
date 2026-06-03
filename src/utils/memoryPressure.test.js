import {
  estimateDeployedRamGb,
  assessMemoryPressure,
  maxKvUsage,
  resolveRamGb,
} from './memoryPressure';
import { getModeMemoryWeight } from './modeManifest';

const agents = (n) => Array.from({ length: n }, (_, i) => ({ name: `agent${i}`, backend: 'llama' }));

describe('getModeMemoryWeight', () => {
  it('returns 1 for flat', () => {
    expect(getModeMemoryWeight('flat')).toBe(1);
  });

  it('returns 2 for pipeline and cascade', () => {
    expect(getModeMemoryWeight('pipeline')).toBe(2);
    expect(getModeMemoryWeight('cascade')).toBe(2);
  });
});

describe('estimateDeployedRamGb', () => {
  it('baseline with two agents is near model+OS budget', () => {
    const gb = estimateDeployedRamGb(agents(2), 'flat');
    expect(gb).toBeCloseTo(26, 0);
  });

  it('adds overhead for extra agents and heavy modes', () => {
    const flat = estimateDeployedRamGb(agents(6), 'flat');
    const pipe = estimateDeployedRamGb(agents(6), 'pipeline');
    expect(pipe).toBeGreaterThan(flat);
  });
});

describe('maxKvUsage', () => {
  it('ignores mlx and non-ok readings', () => {
    expect(maxKvUsage([
      { ok: true, backend: 'mlx', usage: 0.99 },
      { ok: true, backend: 'llama', usage: 0.5 },
    ])).toBe(0.5);
  });

  it('returns null when no live readings', () => {
    expect(maxKvUsage([])).toBeNull();
  });
});

describe('resolveRamGb', () => {
  it('prefers live host used_gb when ok', () => {
    const r = resolveRamGb({
      activeAgents: agents(2),
      activeMode: 'flat',
      hostMemory: { ok: true, used_gb: 30.5 },
    });
    expect(r.ramGb).toBe(30.5);
    expect(r.ramSource).toBe('host');
  });

  it('falls back to estimate when host unavailable', () => {
    const r = resolveRamGb({
      activeAgents: agents(2),
      activeMode: 'flat',
      hostMemory: { ok: false },
    });
    expect(r.ramSource).toBe('estimate');
    expect(r.ramGb).toBeCloseTo(26, 0);
  });
});

describe('assessMemoryPressure', () => {
  it('uses host RAM for band when snapshot available', () => {
    const a = assessMemoryPressure({
      activeAgents: agents(2),
      activeMode: 'flat',
      kvReadings: [],
      hostMemory: { ok: true, used_gb: 34, total_gb: 36 },
    });
    expect(a.ramSource).toBe('host');
    expect(a.bandId).toBe('high');
  });

  it('low band for minimal deployment', () => {
    const a = assessMemoryPressure({ activeAgents: agents(2), activeMode: 'flat', kvReadings: [] });
    expect(a.bandId).toBe('low');
    expect(a.shouldWarnOnSubmit).toBe(false);
  });

  it('warns on large roster', () => {
    const a = assessMemoryPressure({ activeAgents: agents(10), activeMode: 'pipeline', kvReadings: [] });
    expect(a.bandId).not.toBe('low');
    expect(a.shouldWarnOnSubmit).toBe(true);
    expect(a.suggestSafeProfile).toBe(true);
    expect(a.suggestFlatMode).toBe(true);
  });

  it('includes KV slot warning separately from RAM band', () => {
    const a = assessMemoryPressure({
      activeAgents: agents(2),
      activeMode: 'flat',
      kvReadings: [{ ok: true, backend: 'llama', usage: 0.92 }],
    });
    expect(a.bandId).toBe('low');
    expect(a.shouldWarnOnSubmit).toBe(true);
    expect(a.warnings.some(w => w.includes('KV cache'))).toBe(true);
  });
});
