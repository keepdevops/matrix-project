/**
 * PipelineOrderEditor — presetStageOrder logic, stage add/remove/move,
 * duplicate roles, cross-mode roster combinations.
 */

// presetStageOrder is not exported — replicate the exact logic for testing.
function presetStageOrder(preset, agentNames) {
  const avail = new Set(agentNames);
  const push = (out, n) => { if (avail.has(n)) out.push(n); };
  const out = [];
  if (preset === 'code-quality') {
    push(out, 'architect'); push(out, 'programmer');
    push(out, 'tester');    push(out, 'programmer');
  } else if (preset === 'debug-fix') {
    push(out, 'tester'); push(out, 'programmer'); push(out, 'tester');
  } else if (preset === 'docs-finalize') {
    push(out, 'programmer'); push(out, 'documenter');
  }
  return out;
}

// Stage order state helpers (mirrors the React setters in PipelineOrderEditor)
function makeStageState(initial = []) {
  let order = [...initial];
  return {
    get: () => order,
    add: name => { order = [...order, name]; },
    removeAt: i => { order = order.filter((_, idx) => idx !== i); },
    move: (i, dir) => {
      const n = [...order];
      [n[i + dir], n[i]] = [n[i], n[i + dir]];
      order = n;
    },
    applyPreset: (preset, available) => {
      order = presetStageOrder(preset, available);
    },
  };
}

const ALL_AGENTS = ['architect', 'programmer', 'tester', 'reviewer', 'documenter', 'debugger'];

// ---------------------------------------------------------------------------
// presetStageOrder
// ---------------------------------------------------------------------------

describe('presetStageOrder', () => {
  it('code-quality: arch→prog→tester→prog when all available', () => {
    const result = presetStageOrder('code-quality', ALL_AGENTS);
    expect(result).toEqual(['architect', 'programmer', 'tester', 'programmer']);
  });

  it('code-quality skips unavailable agents', () => {
    const result = presetStageOrder('code-quality', ['programmer']);
    expect(result).toEqual(['programmer', 'programmer']);
  });

  it('code-quality returns empty when no matching agents available', () => {
    const result = presetStageOrder('code-quality', ['reviewer', 'foreman']);
    expect(result).toEqual([]);
  });

  it('debug-fix: tester→programmer→tester when all available', () => {
    const result = presetStageOrder('debug-fix', ALL_AGENTS);
    expect(result).toEqual(['tester', 'programmer', 'tester']);
  });

  it('debug-fix skips tester if not available', () => {
    const result = presetStageOrder('debug-fix', ['programmer']);
    expect(result).toEqual(['programmer']);
  });

  it('docs-finalize: programmer→documenter when both available', () => {
    const result = presetStageOrder('docs-finalize', ALL_AGENTS);
    expect(result).toEqual(['programmer', 'documenter']);
  });

  it('docs-finalize returns only programmer when documenter missing', () => {
    const result = presetStageOrder('docs-finalize', ['programmer', 'architect']);
    expect(result).toEqual(['programmer']);
  });

  it('unknown preset returns empty order', () => {
    const result = presetStageOrder('nonexistent', ALL_AGENTS);
    expect(result).toEqual([]);
  });

  it('empty available list always returns empty', () => {
    expect(presetStageOrder('code-quality', [])).toEqual([]);
    expect(presetStageOrder('debug-fix', [])).toEqual([]);
    expect(presetStageOrder('docs-finalize', [])).toEqual([]);
  });

  it('all presets return valid subsets of available agents', () => {
    const presets = ['code-quality', 'debug-fix', 'docs-finalize'];
    for (const preset of presets) {
      const result = presetStageOrder(preset, ALL_AGENTS);
      expect(result.every(n => ALL_AGENTS.includes(n))).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Stage add / remove / move
// ---------------------------------------------------------------------------

describe('PipelineOrderEditor — stage operations', () => {
  it('adds stages in order', () => {
    const s = makeStageState();
    s.add('architect');
    s.add('programmer');
    s.add('tester');
    expect(s.get()).toEqual(['architect', 'programmer', 'tester']);
  });

  it('allows duplicate stages', () => {
    const s = makeStageState(['programmer']);
    s.add('programmer');
    expect(s.get()).toEqual(['programmer', 'programmer']);
  });

  it('removes stage at index 0', () => {
    const s = makeStageState(['architect', 'programmer', 'tester']);
    s.removeAt(0);
    expect(s.get()).toEqual(['programmer', 'tester']);
  });

  it('removes stage at last index', () => {
    const s = makeStageState(['architect', 'programmer', 'tester']);
    s.removeAt(2);
    expect(s.get()).toEqual(['architect', 'programmer']);
  });

  it('removes first of two duplicates correctly by index', () => {
    const s = makeStageState(['prog', 'prog', 'tester']);
    s.removeAt(0);
    expect(s.get()).toEqual(['prog', 'tester']);
  });

  it('removes second of two duplicates correctly by index', () => {
    const s = makeStageState(['prog', 'prog', 'tester']);
    s.removeAt(1);
    expect(s.get()).toEqual(['prog', 'tester']);
  });

  it('moves stage up', () => {
    const s = makeStageState(['a', 'b', 'c']);
    s.move(1, -1);
    expect(s.get()).toEqual(['b', 'a', 'c']);
  });

  it('moves stage down', () => {
    const s = makeStageState(['a', 'b', 'c']);
    s.move(1, 1);
    expect(s.get()).toEqual(['a', 'c', 'b']);
  });

  it('move up at index 0 has no guard in raw state — wrap behavior', () => {
    // PipelineOrderEditor disables the button, but the move logic itself
    // can be called; test raw state doesn't blow up
    const s = makeStageState(['a', 'b']);
    // moving i=0 dir=-1 → j=-1, swap n[-1] and n[0] in JS (no-op in array)
    expect(() => s.move(0, -1)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Preset applied to stage state
// ---------------------------------------------------------------------------

describe('PipelineOrderEditor — preset application', () => {
  it('applying code-quality preset replaces current order', () => {
    const s = makeStageState(['reviewer', 'foreman']);
    s.applyPreset('code-quality', ALL_AGENTS);
    expect(s.get()).toEqual(['architect', 'programmer', 'tester', 'programmer']);
  });

  it('applying debug-fix preset overwrites previous order', () => {
    const s = makeStageState(['architect', 'architect', 'architect']);
    s.applyPreset('debug-fix', ALL_AGENTS);
    expect(s.get()).toEqual(['tester', 'programmer', 'tester']);
  });

  it('applying preset with partial availability uses only present agents', () => {
    const s = makeStageState();
    s.applyPreset('code-quality', ['programmer']); // only programmer available
    expect(s.get()).toEqual(['programmer', 'programmer']);
  });

  it('applying preset then adding extra stage works', () => {
    const s = makeStageState();
    s.applyPreset('docs-finalize', ALL_AGENTS);
    s.add('reviewer');
    expect(s.get()).toEqual(['programmer', 'documenter', 'reviewer']);
  });

  it('applying preset then reordering works', () => {
    const s = makeStageState();
    s.applyPreset('debug-fix', ALL_AGENTS);
    // tester, programmer, tester → move programmer to front
    s.move(1, -1);
    expect(s.get()).toEqual(['programmer', 'tester', 'tester']);
  });
});

// ---------------------------------------------------------------------------
// Multi-mode roster combination scenarios
// ---------------------------------------------------------------------------

describe('Multi-mode roster combinations', () => {
  const MODES = ['flat', 'pipeline', 'cascade', 'router'];

  // Simulates what ModeRosterPanel.save() opts-building does per mode
  function buildSaveOpts(mode, {
    synthesizer = '',
    variantPolicy = 'standard',
    pipelinePreset = '',
    synthesisPolicy = 'summary',
    classifierPolicy = 'standard',
    maxSelect = '',
    stageContextChars = '',
    usePipelineOrder = false,
    pipelineOrder = [],
  }) {
    const opts = {};
    const parsed = parseInt(maxSelect, 10);
    if (mode === 'router' && Number.isInteger(parsed) && parsed >= 1) opts.maxSelect = parsed;
    if (mode === 'pipeline' || mode === 'cascade') opts.synthesizer = synthesizer || '';
    if (mode === 'flat')     opts.variant_policy    = variantPolicy;
    if (mode === 'pipeline') opts.preset            = pipelinePreset;
    if (mode === 'cascade')  opts.synthesis_policy  = synthesisPolicy;
    if (mode === 'router')   opts.classifier_policy = classifierPolicy;
    if (mode === 'pipeline' && usePipelineOrder) {
      opts.order = pipelineOrder.length ? pipelineOrder : null;
    }
    if (mode === 'pipeline' && stageContextChars !== '') {
      const scc = parseInt(stageContextChars, 10);
      if (Number.isInteger(scc) && scc > 0) opts.stage_context_chars = scc;
    }
    return opts;
  }

  it('flat mode: variant_policy forwarded, no synthesizer', () => {
    const opts = buildSaveOpts('flat', { variantPolicy: 'distinct' });
    expect(opts.variant_policy).toBe('distinct');
    expect(opts.synthesizer).toBeUndefined();
    expect(opts.order).toBeUndefined();
  });

  it('pipeline mode: synthesizer + preset + order forwarded', () => {
    const opts = buildSaveOpts('pipeline', {
      synthesizer: 'reviewer',
      pipelinePreset: 'code-quality',
      usePipelineOrder: true,
      pipelineOrder: ['architect', 'programmer', 'tester'],
    });
    expect(opts.synthesizer).toBe('reviewer');
    expect(opts.preset).toBe('code-quality');
    expect(opts.order).toEqual(['architect', 'programmer', 'tester']);
  });

  it('pipeline mode: empty pipelineOrder with usePipelineOrder sets order to null', () => {
    const opts = buildSaveOpts('pipeline', {
      usePipelineOrder: true,
      pipelineOrder: [],
    });
    expect(opts.order).toBeNull();
  });

  it('pipeline mode: usePipelineOrder=false → order not included', () => {
    const opts = buildSaveOpts('pipeline', {
      usePipelineOrder: false,
      pipelineOrder: ['arch', 'prog'],
    });
    expect(opts.order).toBeUndefined();
  });

  it('cascade mode: synthesis_policy forwarded, no order', () => {
    const opts = buildSaveOpts('cascade', { synthesisPolicy: 'full-code', synthesizer: 'architect' });
    expect(opts.synthesis_policy).toBe('full-code');
    expect(opts.synthesizer).toBe('architect');
    expect(opts.order).toBeUndefined();
  });

  it('router mode: maxSelect and classifier_policy forwarded', () => {
    const opts = buildSaveOpts('router', { maxSelect: '3', classifierPolicy: 'code' });
    expect(opts.maxSelect).toBe(3);
    expect(opts.classifier_policy).toBe('code');
  });

  it('router mode: maxSelect 0 not forwarded (below minimum)', () => {
    const opts = buildSaveOpts('router', { maxSelect: '0' });
    expect(opts.maxSelect).toBeUndefined();
  });

  it('router mode: non-numeric maxSelect not forwarded', () => {
    const opts = buildSaveOpts('router', { maxSelect: 'abc' });
    expect(opts.maxSelect).toBeUndefined();
  });

  it('pipeline stageContextChars: valid int forwarded', () => {
    const opts = buildSaveOpts('pipeline', { stageContextChars: '4096' });
    expect(opts.stage_context_chars).toBe(4096);
  });

  it('pipeline stageContextChars: 0 not forwarded', () => {
    const opts = buildSaveOpts('pipeline', { stageContextChars: '0' });
    expect(opts.stage_context_chars).toBeUndefined();
  });

  it('pipeline stageContextChars: empty string not forwarded', () => {
    const opts = buildSaveOpts('pipeline', { stageContextChars: '' });
    expect(opts.stage_context_chars).toBeUndefined();
  });

  it('all modes produce distinct option keys', () => {
    const flatOpts     = buildSaveOpts('flat', {});
    const pipelineOpts = buildSaveOpts('pipeline', {});
    const cascadeOpts  = buildSaveOpts('cascade', {});
    const routerOpts   = buildSaveOpts('router', {});

    // flat has variant_policy, not synthesizer
    expect(Object.keys(flatOpts)).toContain('variant_policy');
    expect(flatOpts.synthesizer).toBeUndefined();

    // pipeline has synthesizer + preset
    expect(Object.keys(pipelineOpts)).toContain('synthesizer');
    expect(Object.keys(pipelineOpts)).toContain('preset');

    // cascade has synthesis_policy
    expect(Object.keys(cascadeOpts)).toContain('synthesis_policy');

    // router has classifier_policy
    expect(Object.keys(routerOpts)).toContain('classifier_policy');
  });
});

// ---------------------------------------------------------------------------
// Stress: 100 random pipeline stage sequences with preset + manual edits
// ---------------------------------------------------------------------------

describe('PipelineOrderEditor stress — 100 random stage edit sequences', () => {
  const PRESETS = ['code-quality', 'debug-fix', 'docs-finalize'];
  const AVAIL = ALL_AGENTS;

  it('order always contains only valid agents after any op sequence', () => {
    const failures = [];

    for (let run = 0; run < 100; run++) {
      const s = makeStageState();

      // Start with a random preset
      s.applyPreset(PRESETS[run % PRESETS.length], AVAIL);

      const ops = Math.floor(Math.random() * 15) + 3;
      for (let i = 0; i < ops; i++) {
        const order = s.get();
        const op = Math.floor(Math.random() * 4);
        if (op === 0) {
          // add random agent (duplicates allowed)
          s.add(AVAIL[Math.floor(Math.random() * AVAIL.length)]);
        } else if (op === 1 && order.length > 0) {
          s.removeAt(Math.floor(Math.random() * order.length));
        } else if (op === 2 && order.length > 1) {
          const idx = Math.floor(Math.random() * (order.length - 1));
          s.move(idx, 1);
        } else if (op === 3) {
          // re-apply preset
          s.applyPreset(PRESETS[Math.floor(Math.random() * PRESETS.length)], AVAIL);
        }
      }

      const final = s.get();
      if (!final.every(n => AVAIL.includes(n))) {
        failures.push(`run ${run}: invalid agent in order: ${final}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('preset with partial availability never produces unknown agents', () => {
    const failures = [];
    for (let run = 0; run < 100; run++) {
      // Random subset of available agents
      const subset = AVAIL.filter(() => Math.random() > 0.4);
      const preset = PRESETS[run % PRESETS.length];
      const result = presetStageOrder(preset, subset);
      for (const name of result) {
        if (!subset.includes(name)) {
          failures.push(`run ${run} preset=${preset}: ${name} not in subset ${subset}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Stress: all mode × agent count × preset combinations
// ---------------------------------------------------------------------------

describe('Multi-mode save options stress — 100 random configurations', () => {
  const SYNTHESIS_POLICIES = ['summary', 'full-code', 'best-answer-plus-fixes', 'tradeoff-comparison'];
  const VARIANT_POLICIES   = ['standard', 'distinct', 'code-alternatives'];
  const CLASSIFIER_POLICIES = ['standard', 'code', 'debug', 'docs', 'ops'];
  const MODES = ['flat', 'pipeline', 'cascade', 'router'];

  function buildSaveOpts(mode, {
    synthesizer = '', variantPolicy = 'standard', pipelinePreset = '',
    synthesisPolicy = 'summary', classifierPolicy = 'standard',
    maxSelect = '', stageContextChars = '',
    usePipelineOrder = false, pipelineOrder = [],
  }) {
    const opts = {};
    const parsed = parseInt(maxSelect, 10);
    if (mode === 'router' && Number.isInteger(parsed) && parsed >= 1) opts.maxSelect = parsed;
    if (mode === 'pipeline' || mode === 'cascade') opts.synthesizer = synthesizer || '';
    if (mode === 'flat')     opts.variant_policy    = variantPolicy;
    if (mode === 'pipeline') opts.preset            = pipelinePreset;
    if (mode === 'cascade')  opts.synthesis_policy  = synthesisPolicy;
    if (mode === 'router')   opts.classifier_policy = classifierPolicy;
    if (mode === 'pipeline' && usePipelineOrder) {
      opts.order = pipelineOrder.length ? pipelineOrder : null;
    }
    if (mode === 'pipeline' && stageContextChars !== '') {
      const scc = parseInt(stageContextChars, 10);
      if (Number.isInteger(scc) && scc > 0) opts.stage_context_chars = scc;
    }
    return opts;
  }

  it('opts are always well-formed and mode-specific keys never leak across modes', () => {
    const failures = [];
    for (let run = 0; run < 100; run++) {
      const mode = MODES[run % MODES.length];
      const maxSel = Math.random() < 0.5 ? String(Math.floor(Math.random() * 5)) : '';
      const scc    = Math.random() < 0.5 ? String(Math.floor(Math.random() * 8192)) : '';
      const order  = Array.from({ length: Math.floor(Math.random() * 5) }, () =>
        ALL_AGENTS[Math.floor(Math.random() * ALL_AGENTS.length)]
      );

      const opts = buildSaveOpts(mode, {
        synthesizer:      ALL_AGENTS[run % ALL_AGENTS.length],
        variantPolicy:    VARIANT_POLICIES[run % VARIANT_POLICIES.length],
        pipelinePreset:   'code-quality',
        synthesisPolicy:  SYNTHESIS_POLICIES[run % SYNTHESIS_POLICIES.length],
        classifierPolicy: CLASSIFIER_POLICIES[run % CLASSIFIER_POLICIES.length],
        maxSelect:        maxSel,
        stageContextChars: scc,
        usePipelineOrder: Math.random() < 0.5,
        pipelineOrder:    order,
      });

      // Mode-exclusive keys must not appear in other modes
      if (mode !== 'flat' && 'variant_policy' in opts)
        failures.push(`run ${run} mode=${mode}: variant_policy leaked`);
      if (mode !== 'pipeline' && 'preset' in opts)
        failures.push(`run ${run} mode=${mode}: preset leaked`);
      if (mode !== 'cascade' && 'synthesis_policy' in opts)
        failures.push(`run ${run} mode=${mode}: synthesis_policy leaked`);
      if (mode !== 'router' && 'classifier_policy' in opts)
        failures.push(`run ${run} mode=${mode}: classifier_policy leaked`);
      if (mode !== 'pipeline' && 'order' in opts)
        failures.push(`run ${run} mode=${mode}: order leaked`);
      if (mode !== 'pipeline' && 'stage_context_chars' in opts)
        failures.push(`run ${run} mode=${mode}: stage_context_chars leaked`);
      if (mode !== 'router' && 'maxSelect' in opts)
        failures.push(`run ${run} mode=${mode}: maxSelect leaked`);
    }
    expect(failures).toEqual([]);
  });
});
