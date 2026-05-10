import { qualityPassContextPolicy } from './qualityPassContext';

describe('qualityPassContextPolicy', () => {
  it('raises context budget for cascade and router', () => {
    expect(qualityPassContextPolicy('pipeline').max_context_chars).toBe(30000);
    expect(qualityPassContextPolicy('cascade').max_context_chars).toBe(34000);
    expect(qualityPassContextPolicy('router').max_context_chars).toBe(34000);
  });

  it('uses intermediate budget for flat', () => {
    expect(qualityPassContextPolicy('flat').max_context_chars).toBe(32000);
  });

  it('keeps programmer as refinement target', () => {
    expect(qualityPassContextPolicy('flat').target_agent).toBe('programmer');
  });
});
