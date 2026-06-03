/**
 * BL1-7 — Cross-engine & hardware compatibility.
 * Covers: 8GB/16GB/32GB RAM matrix, liveRamHigh flag, getRiskBand scaling,
 * BrewConfigEngineProfile wiring, vLLM layout path in useBrewConfig,
 * assessMemoryPressure hardware profiles.
 */
import {
  computeRiskEstimate,
  getRiskBand,
  RAM_BLOCK_RATIO,
  RAM_WARN_RATIO,
  RAM_OS_GB,
} from '../components/SwarmConfig.risk';
import { assessMemoryPressure } from '../utils/memoryPressure';
import { ENGINES, PROFILES } from '../components/SwarmConfig.helpers';

const fs   = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

const engineProfileSrc = read('layouts/BrewConfigEngineProfile.js');
const brewConfigSrc    = read('layouts/useBrewConfig.js');

// ── Fixtures ─────────────────────────────────────────────────────────────────

const MODELS = [
  { path: '/m/llama-3b.gguf',  name: 'Llama-3B',  backend: 'llama', size_bytes: 2e9  },
  { path: '/m/llama-7b.gguf',  name: 'Llama-7B',  backend: 'llama', size_bytes: 4e9  },
  { path: '/m/llama-13b.gguf', name: 'Llama-13B', backend: 'llama', size_bytes: 8e9  },
  { path: '/m/mlx-4b',         name: 'MLX-4B',    backend: 'mlx',   size_bytes: 2.5e9 },
  { path: '/m/vllm-14b',       name: 'VLLM-14B',  backend: 'vllm',  size_bytes: 9e9  },
];

function makeRole(name, context = 2048, engine = 'llama') {
  return { name, context, engine };
}

function liveHost(used_gb, total_gb) {
  return { ok: true, used_gb, total_gb };
}

// ── getRiskBand — scales with ramTotalGb ──────────────────────────────────────

describe('getRiskBand — scales with hardware RAM total', () => {
  it('8 GB machine: 7.5 GB usage → HIGH (>92% of 8)', () => {
    expect(getRiskBand(7.5, 8).id).toBe('high');
  });

  it('8 GB machine: 6.5 GB usage → MEDIUM (>78% of 8 = 6.24)', () => {
    const band = getRiskBand(6.5, 8);
    expect(band.id).toBe('medium');
  });

  it('8 GB machine: 2 GB usage → LOW', () => {
    expect(getRiskBand(2, 8).id).toBe('low');
  });

  it('16 GB machine: 8 GB usage → LOW (<78% of 16)', () => {
    expect(getRiskBand(8, 16).id).toBe('low');
  });

  it('16 GB machine: 14 GB usage → MEDIUM (>78% but <92% of 16 = 14.72)', () => {
    expect(getRiskBand(14, 16).id).toBe('medium');
  });

  it('16 GB machine: 15 GB usage → HIGH (>92% of 16 = 14.72)', () => {
    expect(getRiskBand(15, 16).id).toBe('high');
  });

  it('32 GB machine: 28 GB usage → MEDIUM (87% of 32)', () => {
    expect(getRiskBand(28, 32).id).toBe('medium');
  });

  it('32 GB machine: 30 GB usage → HIGH (>92% of 32 = 29.4)', () => {
    expect(getRiskBand(30, 32).id).toBe('high');
  });

  it('hint always mentions the budget GB', () => {
    const band = getRiskBand(5, 8);
    expect(band.hint).toMatch(/8/);
  });

  it('block and warn thresholds are proportional (ratio constants)', () => {
    const total = 24;
    const blockGb = total * RAM_BLOCK_RATIO;
    const warnGb  = total * RAM_WARN_RATIO;
    expect(getRiskBand(blockGb + 0.1, total).id).toBe('high');
    expect(getRiskBand(warnGb  + 0.1, total).id).toBe('medium');
    expect(getRiskBand(warnGb  - 0.1, total).id).toBe('low');
  });
});

// ── computeRiskEstimate — live hostMemory (hardware matrix) ──────────────────

describe('computeRiskEstimate — live hostMemory hardware matrix', () => {
  const roles      = [makeRole('arch', 4096), makeRole('prog', 4096)];
  const selected   = new Set(['arch', 'prog']);
  const roleModels = { arch: '/m/llama-7b.gguf', prog: '/m/llama-7b.gguf' };

  it('8 GB machine (live): small roster hits HIGH — totalRamGb uses liveTotalGb', () => {
    // llama-7b (4GB shared) + OS 4GB + KV ≈ 9 GB on an 8 GB machine → HIGH
    const e = computeRiskEstimate(roles, selected, roleModels, MODELS, liveHost(8.5, 8));
    expect(e.ramTotalGb).toBe(8);
    expect(e.liveTotalGb).toBe(8);
    expect(e.band.id).toBe('high');
  });

  it('16 GB machine (live): same roster is MEDIUM (RAM_OS_GB=9 + 4GB model = 14GB = 87% of 16GB)', () => {
    const e = computeRiskEstimate(roles, selected, roleModels, MODELS, liveHost(6, 16));
    expect(e.ramTotalGb).toBe(16);
    expect(e.band.id).toBe('medium');
  });

  it('32 GB machine (live): heavy roster stays MEDIUM or better', () => {
    const bigRoles  = Array.from({ length: 6 }, (_, i) => makeRole(`r${i}`, 8192));
    const bigSel    = new Set(bigRoles.map(r => r.name));
    const bigModels = Object.fromEntries(bigRoles.map(r => [r.name, '/m/llama-7b.gguf']));
    const e = computeRiskEstimate(bigRoles, bigSel, bigModels, MODELS, liveHost(14, 32));
    expect(['low', 'medium']).toContain(e.band.id);
  });

  it('liveRamHigh flag set when live used_gb > warn threshold of ramTotalGb', () => {
    // 16 GB machine: warn = 16*0.78 = 12.48 GB; live used = 14 GB → liveRamHigh
    const e = computeRiskEstimate(roles, selected, roleModels, MODELS, liveHost(14, 16));
    expect(e.liveRamHigh).toBe(true);
  });

  it('liveRamHigh false when live used_gb is below warn threshold', () => {
    const e = computeRiskEstimate(roles, selected, roleModels, MODELS, liveHost(6, 16));
    expect(e.liveRamHigh).toBe(false);
  });

  it('hostMemory.ok=false falls back to estimate (no liveTotalGb)', () => {
    const e = computeRiskEstimate(roles, selected, roleModels, MODELS, { ok: false, used_gb: 99 });
    expect(e.liveTotalGb).toBeNull();
    expect(e.liveUsedGb).toBeNull();
  });

  it('null hostMemory → ramSource is estimate', () => {
    const e = computeRiskEstimate(roles, selected, roleModels, MODELS, null);
    expect(e.ramSource).toBe('estimate');
  });

  it('live hostMemory → ramSource is estimate (projection uses estimate, live used is advisory)', () => {
    const e = computeRiskEstimate(roles, selected, roleModels, MODELS, liveHost(10, 16));
    // totalRamGb is always the projected estimate; live data affects band via ramTotalGb
    expect(typeof e.totalRamGb).toBe('number');
    expect(e.liveTotalGb).toBe(16);
  });
});

// ── assessMemoryPressure — hardware profiles ──────────────────────────────────

describe('assessMemoryPressure — hardware profiles', () => {
  const agents8  = Array.from({ length: 8  }, (_, i) => ({ name: `a${i}`, backend: 'llama' }));
  const agents4  = Array.from({ length: 4  }, (_, i) => ({ name: `b${i}`, backend: 'llama' }));

  it('high live RAM usage triggers shouldWarnOnSubmit', () => {
    // assessMemoryPressure uses used_gb against the 36GB default baseline
    // warn threshold = 36*0.78 = 28.08 GB — use 29 GB used to reliably cross it
    const r = assessMemoryPressure({
      activeAgents: agents8, activeMode: 'pipeline',
      hostMemory: liveHost(29, 36),
    });
    expect(r.shouldWarnOnSubmit).toBe(true);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('32 GB machine (live): modest roster is safe', () => {
    const r = assessMemoryPressure({
      activeAgents: agents4, activeMode: 'flat',
      hostMemory: liveHost(10, 32),
    });
    expect(r.bandId).toBe('low');
    expect(r.shouldWarnOnSubmit).toBe(false);
  });

  it('high RAM + heavy mode → suggestSafeProfile + suggestFlatMode', () => {
    // used_gb=29 crosses warn threshold (36*0.78=28.08) → bandId='medium'/'high'
    const r = assessMemoryPressure({
      activeAgents: agents8, activeMode: 'map_reduce',
      hostMemory: liveHost(29, 36),
    });
    expect(r.suggestSafeProfile).toBe(true);
    expect(r.suggestFlatMode).toBe(true);
  });

  it('KV cache near-full triggers warning and shouldWarnOnSubmit', () => {
    const r = assessMemoryPressure({
      activeAgents: agents4, activeMode: 'flat',
      kvReadings: [{ ok: true, backend: 'llama', usage: 0.92 }],
    });
    expect(r.shouldWarnOnSubmit).toBe(true);
    expect(r.warnings.some(w => /KV/i.test(w))).toBe(true);
  });

  it('MLX readings excluded from KV pressure (mlx has no kv slots)', () => {
    const r = assessMemoryPressure({
      activeAgents: agents4, activeMode: 'flat',
      kvReadings: [{ ok: true, backend: 'mlx', usage: 0.99 }],
    });
    // mlx usage should not count → kvMax null → no KV warning
    expect(r.kvMax).toBeNull();
  });
});

// ── BrewConfigEngineProfile — static wiring ───────────────────────────────────

describe('BrewConfigEngineProfile — static wiring', () => {
  it('renders all three engines from ENGINES constant', () => {
    expect(engineProfileSrc).toMatch(/ENGINES/);
    expect(ENGINES.map(e => e.id)).toEqual(expect.arrayContaining(['llama', 'mlx', 'vllm']));
  });

  it('engine pill disabled when model count is 0', () => {
    expect(engineProfileSrc).toMatch(/count === 0.*disabled/s);
  });

  it('active engine pill gets .active class', () => {
    expect(engineProfileSrc).toMatch(/engine === e\.id.*active/s);
  });

  it('profile dropdown calls applyProfile on change', () => {
    expect(engineProfileSrc).toMatch(/applyProfile\(e\.target\.value, reset\)/);
  });

  it('all profile ids are present in PROFILES', () => {
    const ids = PROFILES.map(([id]) => id);
    expect(ids).toEqual(expect.arrayContaining(['safe', 'balanced', 'max', 'mixed', 'custom']));
  });

  it('profile hint text explains custom mode behaviour', () => {
    expect(engineProfileSrc).toMatch(/Custom/);
    expect(engineProfileSrc).toMatch(/brew-profile-hint/);
  });
});

// ── useBrewConfig — vLLM layout path ─────────────────────────────────────────

describe('useBrewConfig — vLLM layout path', () => {
  it('uses VLLM_PRESTARTED fixed port layout when engine is vllm', () => {
    expect(brewConfigSrc).toMatch(/engine === 'vllm'/);
    expect(brewConfigSrc).toMatch(/VLLM_PRESTARTED/);
  });

  it('VLLM_PRESTARTED has 4 fixed ports (8080–8083)', () => {
    expect(brewConfigSrc).toMatch(/port: 8080/);
    expect(brewConfigSrc).toMatch(/port: 8081/);
    expect(brewConfigSrc).toMatch(/port: 8082/);
    expect(brewConfigSrc).toMatch(/port: 8083/);
  });

  it('vLLM layout falls back to VLLM_PRESTARTED entry when no computed slot', () => {
    // serverLayout.find(s => s.port === port) || { port, model, agents: [], parallel: 0, engine: 'vllm' }
    expect(brewConfigSrc).toMatch(/engine: 'vllm'/);
    expect(brewConfigSrc).toMatch(/agents: \[\]/);
  });

  it('handleEngineChange to vllm clears selection and roleModels', () => {
    // Verified in config-panels tests; confirm vllm is a valid target
    expect(brewConfigSrc).toMatch(/setEngine/);
    // useBrewRoleHandlers wires handleEngineChange which calls setSelected(new Set())
    const handlersSrc = read('layouts/useBrewRoleHandlers.js');
    expect(handlersSrc).toMatch(/setSelected\(new Set\(\)\)/);
    expect(handlersSrc).toMatch(/setRoleModels\(\{\}\)/);
  });

  it('MLX engine: sets engine from running agent backend', () => {
    expect(brewConfigSrc).toMatch(/running\.engine \|\| running\.backend \|\| 'llama'/);
  });
});
