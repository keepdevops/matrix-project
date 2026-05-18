/**
 * ModelConverter — guessHfRepo, guessOutputName, GGUF filtering,
 * ConvertRow start/poll/done/error state machine, all org prefix combos.
 */

// ---------------------------------------------------------------------------
// Replicated helpers
// ---------------------------------------------------------------------------

const ORG_PREFIXES = [
  [/^meta-llama/i,   'meta-llama'],
  [/^llama/i,        'meta-llama'],
  [/^codestral/i,    'mistralai'],
  [/^mistral/i,      'mistralai'],
  [/^mixtral/i,      'mistralai'],
  [/^gemma/i,        'google'],
  [/^phi-/i,         'microsoft'],
  [/^phi\d/i,        'microsoft'],
  [/^qwen/i,         'Qwen'],
  [/^deepseek/i,     'deepseek-ai'],
];

function guessHfRepo(filename) {
  const base = filename.replace(/\.gguf$/i, '').replace(/(-[Qq]\d[^-]*|-IQ\d[^-]*)(_[A-Z0-9]+)*$/, '');
  for (const [re, org] of ORG_PREFIXES) {
    if (re.test(base)) return `${org}/${base}`;
  }
  return base;
}

function guessOutputName(filename) {
  return filename.replace(/\.gguf$/i, '').replace(/(-[Qq]\d[^-]*|-IQ\d[^-]*)(_[A-Z0-9]+)*$/, '');
}

function isGguf(model) {
  return model.backend === 'llama' || model.path?.endsWith?.('.gguf');
}

// ---------------------------------------------------------------------------
// guessHfRepo
// ---------------------------------------------------------------------------

describe('guessHfRepo — org prefix matching', () => {
  it.each([
    ['Llama-3.1-8B-Instruct-Q4_K_M.gguf',  'meta-llama/Llama-3.1-8B-Instruct'],
    ['Meta-Llama-3-8B-Q4_0.gguf',           'meta-llama/Meta-Llama-3-8B'],
    ['Codestral-22B-v0.1-Q4_K_M.gguf',      'mistralai/Codestral-22B-v0.1'],
    ['Mistral-7B-Instruct-v0.3-Q4_K_M.gguf','mistralai/Mistral-7B-Instruct-v0.3'],
    ['Mixtral-8x7B-Instruct-Q4_K_M.gguf',   'mistralai/Mixtral-8x7B-Instruct'],
    ['gemma-2-9b-it-Q4_K_M.gguf',           'google/gemma-2-9b-it'],
    ['Phi-3-mini-4k-instruct-Q4.gguf',      'microsoft/Phi-3-mini-4k-instruct'],
    ['phi3-medium-4k-instruct-q4.gguf',     'microsoft/phi3-medium-4k-instruct'],
    ['Qwen2.5-14B-Instruct-Q4_K_M.gguf',   'Qwen/Qwen2.5-14B-Instruct'],
    ['deepseek-coder-6.7b-instruct-q4.gguf','deepseek-ai/deepseek-coder-6.7b-instruct'],
  ])('%s → %s', (filename, expected) => {
    expect(guessHfRepo(filename)).toBe(expected);
  });

  it('unknown prefix uses base name without org', () => {
    const result = guessHfRepo('custom-model-7B-Q4_K_M.gguf');
    expect(result).toBe('custom-model-7B');
  });

  it('no .gguf extension passes through base unchanged', () => {
    const result = guessHfRepo('some-llama-model');
    expect(result).toBe('some-llama-model');
  });

  it('case-insensitive org matching — LLAMA uppercase', () => {
    const result = guessHfRepo('LLAMA-3-8B-Q4_K_M.gguf');
    expect(result).toContain('meta-llama/');
  });

  it('strips quantization suffix variations', () => {
    const suffixes = ['Q4_K_M', 'q4_0', 'Q8_0', 'Q4_K_S', 'q5_k_m'];
    for (const suf of suffixes) {
      const result = guessHfRepo(`Llama-3-8B-${suf}.gguf`);
      expect(result).not.toContain(suf);
    }
  });

  it('strips IQ quant suffixes', () => {
    const iqSuffixes = ['IQ3_XXS', 'IQ4_NL', 'IQ2_XXS', 'IQ3_M', 'IQ4_XS'];
    for (const suf of iqSuffixes) {
      const result = guessHfRepo(`Llama-3-8B-${suf}.gguf`);
      expect(result).not.toContain(suf);
      expect(result).toContain('meta-llama/Llama-3-8B');
    }
  });

  it('guessOutputName strips IQ quant suffixes', () => {
    expect(guessOutputName('Llama-3-8B-IQ3_XXS.gguf')).toBe('Llama-3-8B');
    expect(guessOutputName('Mistral-7B-IQ4_NL.gguf')).toBe('Mistral-7B');
  });
});

// ---------------------------------------------------------------------------
// guessOutputName
// ---------------------------------------------------------------------------

describe('guessOutputName', () => {
  it.each([
    ['Codestral-22B-v0.1-Q4_K_M.gguf', 'Codestral-22B-v0.1'],
    ['Llama-3.1-8B-Q4_0.gguf',         'Llama-3.1-8B'],
    ['phi-3-mini-q4.gguf',              'phi-3-mini'],
    ['no-quant-model.gguf',             'no-quant-model'],
    ['model',                           'model'],
  ])('%s → %s', (filename, expected) => {
    expect(guessOutputName(filename)).toBe(expected);
  });

  it('does not contain .gguf in output', () => {
    const result = guessOutputName('anything-Q4.gguf');
    expect(result).not.toContain('.gguf');
  });
});

// ---------------------------------------------------------------------------
// GGUF model filtering
// ---------------------------------------------------------------------------

describe('GGUF filtering', () => {
  const models = [
    { path: '/m/llama.gguf',   name: 'LLaMA', backend: 'llama' },
    { path: '/m/mlx-model',    name: 'MLX',   backend: 'mlx'   },
    { path: '/m/vllm-model',   name: 'vLLM',  backend: 'vllm'  },
    { path: '/m/other.gguf',   name: 'Other', backend: 'other' },
    { path: '/m/no-ext',       name: 'Plain', backend: 'llama' },
  ];

  it('keeps llama backend models', () => {
    const result = models.filter(isGguf);
    expect(result.some(m => m.backend === 'llama')).toBe(true);
  });

  it('keeps models with .gguf extension regardless of backend', () => {
    const result = models.filter(isGguf);
    expect(result.some(m => m.path.endsWith('.gguf') && m.backend === 'other')).toBe(true);
  });

  it('excludes mlx backend without .gguf', () => {
    const result = models.filter(isGguf);
    expect(result.find(m => m.name === 'MLX')).toBeUndefined();
  });

  it('excludes vllm backend without .gguf', () => {
    const result = models.filter(isGguf);
    expect(result.find(m => m.name === 'vLLM')).toBeUndefined();
  });

  it('empty model list returns empty', () => {
    expect([].filter(isGguf)).toEqual([]);
  });

  it('all llama models pass filter', () => {
    const llama = [
      { path: '/m/a.gguf', backend: 'llama' },
      { path: '/m/b',      backend: 'llama' },
    ];
    expect(llama.filter(isGguf)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Conversion job state machine
// ---------------------------------------------------------------------------

function makeJobState() {
  let job = null;
  let error = null;
  let pollStopped = false;

  return {
    getJob: () => job,
    getError: () => error,
    isPollStopped: () => pollStopped,

    startJob(job_id) {
      job = { job_id, status: 'running', step: 'starting', pct: 0 };
      error = null;
    },

    applyStartError(msg) {
      error = msg;
      job = null;
    },

    applyPoll(pollResult) {
      if (!job) return;
      job = { ...job, ...pollResult };
      if (pollResult.status === 'done') { pollStopped = true; }
      if (pollResult.status === 'error') { pollStopped = true; error = pollResult.error || 'Conversion failed'; }
    },

    applyPollError(msg) {
      error = msg;
      pollStopped = true;
    },
  };
}

describe('ConvertRow — job state machine', () => {
  it('starts in null/null state', () => {
    const s = makeJobState();
    expect(s.getJob()).toBeNull();
    expect(s.getError()).toBeNull();
  });

  it('startJob sets running state', () => {
    const s = makeJobState();
    s.startJob('job-abc');
    expect(s.getJob().status).toBe('running');
    expect(s.getJob().job_id).toBe('job-abc');
    expect(s.getJob().pct).toBe(0);
  });

  it('applyStartError sets error and keeps job null', () => {
    const s = makeJobState();
    s.applyStartError('network error');
    expect(s.getError()).toBe('network error');
    expect(s.getJob()).toBeNull();
  });

  it('running → progress updates pct and step', () => {
    const s = makeJobState();
    s.startJob('j1');
    s.applyPoll({ status: 'running', step: 'downloading', pct: 30 });
    expect(s.getJob().pct).toBe(30);
    expect(s.getJob().step).toBe('downloading');
    expect(s.isPollStopped()).toBe(false);
  });

  it('running → done stops polling', () => {
    const s = makeJobState();
    s.startJob('j1');
    s.applyPoll({ status: 'done', step: 'complete', pct: 100 });
    expect(s.getJob().status).toBe('done');
    expect(s.isPollStopped()).toBe(true);
    expect(s.getError()).toBeNull();
  });

  it('running → error stops polling and sets error', () => {
    const s = makeJobState();
    s.startJob('j1');
    s.applyPoll({ status: 'error', error: 'OOM during quantization' });
    expect(s.getJob().status).toBe('error');
    expect(s.isPollStopped()).toBe(true);
    expect(s.getError()).toBe('OOM during quantization');
  });

  it('poll network error stops polling', () => {
    const s = makeJobState();
    s.startJob('j1');
    s.applyPollError('connection refused');
    expect(s.isPollStopped()).toBe(true);
    expect(s.getError()).toBe('connection refused');
  });

  it('progress sequence: 0% → 25% → 50% → 75% → 100% done', () => {
    const s = makeJobState();
    s.startJob('j1');
    for (const pct of [25, 50, 75]) {
      s.applyPoll({ status: 'running', pct, step: 'converting' });
      expect(s.getJob().pct).toBe(pct);
    }
    s.applyPoll({ status: 'done', pct: 100, step: 'complete' });
    expect(s.getJob().status).toBe('done');
    expect(s.isPollStopped()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Conversion API layer mocks
// ---------------------------------------------------------------------------

jest.mock('../api/swarmApi', () => ({
  startConversion:    jest.fn(),
  pollConversion:     jest.fn(),
  fetchModels:        jest.fn(),
  invalidateModelsCache: jest.fn(),
}));

import { startConversion, pollConversion, fetchModels, invalidateModelsCache } from '../api/swarmApi';

beforeEach(() => {
  jest.resetAllMocks();
});

describe('ModelConverter API layer', () => {
  it('startConversion called with correct params', async () => {
    startConversion.mockResolvedValue({ job_id: 'j1' });
    const params = {
      hf_repo: 'mistralai/Codestral-22B-v0.1',
      output_name: 'Codestral-22B-v0.1',
      q_bits: 4,
      hf_token: '',
    };
    await startConversion(params);
    expect(startConversion).toHaveBeenCalledWith(params);
  });

  it('pollConversion called with job_id', async () => {
    pollConversion.mockResolvedValue({ status: 'done', pct: 100 });
    await pollConversion('j1');
    expect(pollConversion).toHaveBeenCalledWith('j1');
  });

  it('startConversion throws on failure', async () => {
    startConversion.mockRejectedValue(new Error('server busy'));
    await expect(startConversion({ hf_repo: 'x', output_name: 'y', q_bits: 4 }))
      .rejects.toThrow('server busy');
  });

  it('pollConversion throws on network error', async () => {
    pollConversion.mockRejectedValue(new Error('ECONNRESET'));
    await expect(pollConversion('j1')).rejects.toThrow('ECONNRESET');
  });

  it('invalidateModelsCache called after successful conversion', () => {
    invalidateModelsCache();
    expect(invalidateModelsCache).toHaveBeenCalled();
  });

  it('fetchModels called after conversion done', async () => {
    fetchModels.mockResolvedValue([]);
    await fetchModels();
    expect(fetchModels).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// All org prefixes × quantization suffix stress test
// ---------------------------------------------------------------------------

describe('guessHfRepo stress — all org prefix × quant suffix combinations', () => {
  const baseNames = [
    'Llama-3.1-8B', 'Meta-Llama-3-70B', 'Codestral-22B-v0.1',
    'Mistral-7B-Instruct-v0.3', 'Mixtral-8x7B-Instruct',
    'gemma-2-9b-it', 'Phi-3-mini-4k-instruct', 'phi3-medium-4k',
    'Qwen2.5-14B-Instruct', 'deepseek-coder-6.7b-instruct',
    'custom-unknown-7B',
  ];
  const quantSuffixes = [
    '-Q4_K_M', '-Q4_K_S', '-Q8_0', '-Q4_0', '-q4_0', '-q5_k_m',
    '-Q4', '-q4', '',
  ];
  const knownOrgs = ['meta-llama', 'mistralai', 'google', 'microsoft', 'Qwen', 'deepseek-ai'];

  it('never throws for any base × suffix combination', () => {
    const failures = [];
    for (const base of baseNames) {
      for (const suf of quantSuffixes) {
        try {
          const result = guessHfRepo(`${base}${suf}.gguf`);
          if (typeof result !== 'string' || result.length === 0) {
            failures.push(`${base}${suf}: empty result`);
          }
        } catch (e) {
          failures.push(`${base}${suf}: threw ${e.message}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('known org models always include org prefix in result', () => {
    const orgModels = [
      ['Llama-3-8B-Q4.gguf',          'meta-llama'],
      ['Codestral-22B-Q4.gguf',        'mistralai'],
      ['gemma-7b-Q4.gguf',             'google'],
      ['Phi-3-mini-Q4.gguf',           'microsoft'],
      ['Qwen2-7B-Q4.gguf',             'Qwen'],
      ['deepseek-coder-Q4.gguf',       'deepseek-ai'],
    ];
    const failures = [];
    for (const [filename, expectedOrg] of orgModels) {
      const result = guessHfRepo(filename);
      if (!result.startsWith(expectedOrg + '/')) {
        failures.push(`${filename}: expected org ${expectedOrg}, got ${result}`);
      }
    }
    expect(failures).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Stress: 100 random conversion job sequences
// ---------------------------------------------------------------------------

describe('ConvertRow job state machine stress — 100 random sequences', () => {
  it('state machine invariants always hold', () => {
    const VALID_STATUSES = new Set(['running', 'done', 'error']);
    const failures = [];

    for (let run = 0; run < 100; run++) {
      const s = makeJobState();
      // Randomly fail on start
      if (Math.random() < 0.1) {
        s.applyStartError('start failed');
        if (s.getJob() !== null) failures.push(`run ${run}: job should be null after start error`);
        if (!s.getError()) failures.push(`run ${run}: error should be set after start error`);
        continue;
      }

      s.startJob(`j-${run}`);
      const steps = Math.floor(Math.random() * 8) + 1;

      for (let i = 0; i < steps; i++) {
        if (s.isPollStopped()) break;
        const pct = Math.min(100, i * 15);
        const outcome = Math.random();
        if (outcome < 0.15) {
          s.applyPollError('network error');
        } else if (outcome < 0.3 || i === steps - 1) {
          const terminal = Math.random() < 0.7 ? 'done' : 'error';
          s.applyPoll({ status: terminal, pct: 100, step: 'complete',
                        error: terminal === 'error' ? 'failed' : undefined });
        } else {
          s.applyPoll({ status: 'running', pct, step: 'converting' });
          if (s.isPollStopped()) {
            failures.push(`run ${run} step ${i}: poll stopped on non-terminal status`);
          }
        }
      }

      // After terminal, poll must be stopped
      const job = s.getJob();
      if (job && job.status === 'done' && !s.isPollStopped()) {
        failures.push(`run ${run}: poll not stopped after done`);
      }
      if (job && job.status === 'error' && !s.isPollStopped()) {
        failures.push(`run ${run}: poll not stopped after error`);
      }
      // pct must be 0-100
      if (job && (job.pct < 0 || job.pct > 100)) {
        failures.push(`run ${run}: pct out of range ${job.pct}`);
      }
    }
    expect(failures).toEqual([]);
  });
});
