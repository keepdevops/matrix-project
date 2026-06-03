import { qualityPassContextPolicy } from './qualityPassContext';

describe('qualityPassContextPolicy', () => {
  it('raises context budget for cascade and router', () => {
    expect(qualityPassContextPolicy('pipeline').max_context_chars).toBe(4500);
    expect(qualityPassContextPolicy('cascade').max_context_chars).toBe(5500);
    expect(qualityPassContextPolicy('router').max_context_chars).toBe(5500);
  });

  it('uses intermediate budget for flat', () => {
    expect(qualityPassContextPolicy('flat').max_context_chars).toBe(5000);
  });

  it('keeps programmer as refinement target', () => {
    expect(qualityPassContextPolicy('flat').target_agent).toBe('programmer');
  });
});

// ---------------------------------------------------------------------------
// Shape validation
// ---------------------------------------------------------------------------

test('return value always has max_context_chars, include, and target_agent', () => {
  ['flat', 'pipeline', 'cascade', 'router'].forEach(mode => {
    const policy = qualityPassContextPolicy(mode);
    expect(typeof policy.max_context_chars).toBe('number');
    expect(Array.isArray(policy.include)).toBe(true);
    expect(typeof policy.target_agent).toBe('string');
  });
});

test('include always contains original_prompt', () => {
  ['flat', 'pipeline', 'cascade', 'router', 'unknown'].forEach(mode => {
    expect(qualityPassContextPolicy(mode).include).toContain('original_prompt');
  });
});

test('unknown mode does not throw and returns a valid policy', () => {
  expect(() => qualityPassContextPolicy('unknown')).not.toThrow();
  const policy = qualityPassContextPolicy('unknown');
  expect(policy.max_context_chars).toBe(4500);
  expect(policy.target_agent).toBe('programmer');
});

test('null mode does not throw and returns a valid policy', () => {
  expect(() => qualityPassContextPolicy(null)).not.toThrow();
  const policy = qualityPassContextPolicy(null);
  expect(typeof policy.max_context_chars).toBe('number');
});

test('undefined mode does not throw and returns a valid policy', () => {
  expect(() => qualityPassContextPolicy(undefined)).not.toThrow();
});

test('include list always contains final and programmer', () => {
  ['flat', 'pipeline', 'cascade', 'router'].forEach(mode => {
    const { include } = qualityPassContextPolicy(mode);
    expect(include).toContain('final');
    expect(include).toContain('programmer');
  });
});
