import { renderHook } from '@testing-library/react';
import { useLiveCodeExtraction } from './useLiveCodeExtraction';

describe('useLiveCodeExtraction', () => {
  it('returns partial fence while loading', () => {
    const text = 'Explain:\n```python\nprint("live';
    const { result } = renderHook(() => useLiveCodeExtraction(text, true));
    expect(result.current.isStreaming).toBe(true);
    expect(result.current.isPartial).toBe(true);
    expect(result.current.code).toContain('print');
    expect(result.current.language).toBe('python');
  });

  it('returns final block when not loading', () => {
    const text = '```python\nprint("done")\n```';
    const { result } = renderHook(() => useLiveCodeExtraction(text, false));
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.hasCompleteCode).toBe(true);
    expect(result.current.code).toBe('print("done")');
  });

  it('streaming without text yet', () => {
    const { result } = renderHook(() => useLiveCodeExtraction('', true));
    expect(result.current.isStreaming).toBe(true);
    expect(result.current.hasCode).toBe(false);
  });
});
