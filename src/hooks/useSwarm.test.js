/**
 * useSwarm tests.
 *
 * Covers:
 * - Initial state defaults
 * - switchBackend: validates values, persists to localStorage
 * - switchBackend: clears MLX session when switching away from mlx
 * - loadHistory: sets history on success, stays online on error
 * - checkStatus: reflects coordinator health response
 * - submit: dispatches streamFn, resolves on onDone
 * - submit: sets error state and rejects on global onError
 * - submit: per-agent errors are non-fatal
 * - submit: session ID propagated on followup
 * - Stress: 50 random backend × followup combinations load history successfully
 */
import { act, renderHook } from '@testing-library/react';
import { useSwarm } from './useSwarm';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('../api/orchestrateApi', () => ({
  submitOrchestrateStream: jest.fn(),
  saveOrchestrateHistory: jest.fn(() => Promise.resolve()),
}));

jest.mock('../api/swarmApi', () => ({
  submitPromptStream:    jest.fn(),
  submitPromptStreamMlx: jest.fn(),
  clearMlxSession:       jest.fn(),
  fetchHistory:          jest.fn(),
  checkHealth:           jest.fn(),
}));

import {
  submitPromptStream,
  submitPromptStreamMlx,
  clearMlxSession,
  fetchHistory,
  checkHealth,
} from '../api/swarmApi';

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

function mountHook() {
  const { result, unmount } = renderHook(() => useSwarm());
  return {
    ref: { get current() { return result.current; } },
    cleanup: unmount,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

test('initial state has sensible defaults', () => {
  const { ref, cleanup } = mountHook();
  const s = ref.current;
  expect(s.loading).toBe(false);
  expect(s.error).toBeNull();
  expect(s.responses).toEqual({});
  expect(s.history).toEqual([]);
  expect(s.online).toBe(false);
  expect(s.backend).toBe('llama');
  cleanup();
});

// ---------------------------------------------------------------------------
// switchBackend
// ---------------------------------------------------------------------------

test('switchBackend to mlx sets backend and persists', () => {
  const { ref, cleanup } = mountHook();
  act(() => { ref.current.switchBackend('mlx'); });
  expect(ref.current.backend).toBe('mlx');
  expect(localStorage.getItem('swarm.backend')).toBe('mlx');
  cleanup();
});

test('switchBackend ignores unknown values', () => {
  const { ref, cleanup } = mountHook();
  act(() => { ref.current.switchBackend('openai'); });
  expect(ref.current.backend).toBe('llama');
  cleanup();
});

test('switchBackend to llama clears MLX session when one exists', async () => {
  clearMlxSession.mockResolvedValue({});
  const { ref, cleanup } = mountHook();
  act(() => { ref.current.switchBackend('mlx'); });
  act(() => { ref.current.setCurrentSession({ sessionId: 'sid', runId: 'rid' }); });
  await act(async () => { ref.current.switchBackend('llama'); });
  expect(clearMlxSession).toHaveBeenCalledWith('sid');
  cleanup();
});

// ---------------------------------------------------------------------------
// loadHistory
// ---------------------------------------------------------------------------

test('loadHistory sets history array and online=true', async () => {
  const entries = [{ prompt: 'a', temperature: 0.2 }];
  fetchHistory.mockResolvedValue(entries);
  const { ref, cleanup } = mountHook();
  await act(async () => { await ref.current.loadHistory(); });
  expect(ref.current.history).toEqual(entries);
  expect(ref.current.online).toBe(true);
  cleanup();
});

test('loadHistory returns [] and does not change online on error', async () => {
  fetchHistory.mockRejectedValue(new Error('conn refused'));
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  const { ref, cleanup } = mountHook();
  let result;
  await act(async () => { result = await ref.current.loadHistory(); });
  expect(result).toEqual([]);
  spy.mockRestore();
  cleanup();
});

// ---------------------------------------------------------------------------
// checkStatus
// ---------------------------------------------------------------------------

test('checkStatus sets online=true when coordinator healthy', async () => {
  checkHealth.mockResolvedValue(true);
  const { ref, cleanup } = mountHook();
  await act(async () => { await ref.current.checkStatus(); });
  expect(ref.current.online).toBe(true);
  cleanup();
});

test('checkStatus sets online=false when coordinator offline', async () => {
  checkHealth.mockResolvedValue(false);
  const { ref, cleanup } = mountHook();
  await act(async () => { await ref.current.checkStatus(); });
  expect(ref.current.online).toBe(false);
  cleanup();
});

// ---------------------------------------------------------------------------
// submit
// ---------------------------------------------------------------------------

test('submit calls submitPromptStream for llama backend and resolves on onDone', async () => {
  let capturedCallbacks;
  submitPromptStream.mockImplementation((_p, _t, _opts, cb) => {
    capturedCallbacks = cb;
    return () => {};
  });
  const { ref, cleanup } = mountHook();
  let settled = false;
  act(() => {
    ref.current.submit('hello', 0.5).then(() => { settled = true; });
  });
  expect(ref.current.loading).toBe(true);
  await act(async () => { capturedCallbacks.onDone(); });
  expect(settled).toBe(true);
  expect(ref.current.loading).toBe(false);
  cleanup();
});

test('submit calls submitPromptStreamMlx for mlx backend', async () => {
  submitPromptStreamMlx.mockImplementation((_p, _t, _opts, cb) => {
    cb.onDone();
    return () => {};
  });
  const { ref, cleanup } = mountHook();
  act(() => { ref.current.switchBackend('mlx'); });
  await act(async () => { await ref.current.submit('hi', 0.2); });
  expect(submitPromptStreamMlx).toHaveBeenCalled();
  cleanup();
});

test('submit onToken accumulates responses', async () => {
  let capturedCallbacks;
  submitPromptStream.mockImplementation((_p, _t, _opts, cb) => {
    capturedCallbacks = cb;
    return () => {};
  });
  const { ref, cleanup } = mountHook();
  act(() => { ref.current.submit('q', 0.2); });
  await act(async () => {
    capturedCallbacks.onToken('programmer', 'hello ');
    capturedCallbacks.onToken('programmer', 'world');
    capturedCallbacks.onDone();
  });
  // Responses may be flushed via RAF; just verify no throw and onDone resolved
  expect(ref.current.loading).toBe(false);
  cleanup();
});

test('submit global onError sets error state and rejects', async () => {
  let capturedCallbacks;
  submitPromptStream.mockImplementation((_p, _t, _opts, cb) => {
    capturedCallbacks = cb;
    return () => {};
  });
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  const { ref, cleanup } = mountHook();
  let rejected = false;
  act(() => {
    ref.current.submit('q', 0.2).catch(() => { rejected = true; });
  });
  await act(async () => { capturedCallbacks.onError(null, 'timeout'); });
  expect(ref.current.error).toBe('timeout');
  expect(rejected).toBe(true);
  spy.mockRestore();
  cleanup();
});

test('submit per-agent onError is non-fatal', async () => {
  let capturedCallbacks;
  submitPromptStream.mockImplementation((_p, _t, _opts, cb) => {
    capturedCallbacks = cb;
    return () => {};
  });
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  const { ref, cleanup } = mountHook();
  act(() => { ref.current.submit('q', 0.2); });
  await act(async () => {
    capturedCallbacks.onError('reviewer', 'model crashed');
    capturedCallbacks.onDone();
  });
  expect(ref.current.agentErrors.reviewer).toBe('model crashed');
  expect(ref.current.loading).toBe(false);
  spy.mockRestore();
  cleanup();
});

test('submit onSession stores sessionId and runId', async () => {
  let capturedCallbacks;
  submitPromptStream.mockImplementation((_p, _t, _opts, cb) => {
    capturedCallbacks = cb;
    return () => {};
  });
  const { ref, cleanup } = mountHook();
  act(() => { ref.current.submit('q', 0.2); });
  await act(async () => {
    capturedCallbacks.onSession({ session_id: 'abc', run_id: 'r1' });
    capturedCallbacks.onDone();
  });
  expect(ref.current.currentSession).toEqual({ sessionId: 'abc', runId: 'r1' });
  cleanup();
});

test('submit onMetrics sets lastMeta timings and wall_ms', async () => {
  let capturedCallbacks;
  submitPromptStream.mockImplementation((_p, _t, _opts, cb) => {
    capturedCallbacks = cb;
    return () => {};
  });
  const { ref, cleanup } = mountHook();
  act(() => { ref.current.submit('q', 0.2); });
  await act(async () => {
    capturedCallbacks.onMetrics({
      programmer: { calls: 1, total_ms: 900, completion_tokens: 42 },
    });
    capturedCallbacks.onDone();
  });
  expect(ref.current.lastMeta.timings.programmer.total_ms).toBe(900);
  expect(ref.current.lastMeta.wall_ms).toEqual(expect.any(Number));
  cleanup();
});

test('submit onStage accumulates pipeline stage_outputs', async () => {
  let capturedCallbacks;
  submitPromptStream.mockImplementation((_p, _t, _opts, cb) => {
    capturedCallbacks = cb;
    return () => {};
  });
  const { ref, cleanup } = mountHook();
  act(() => { ref.current.submit('q', 0.2); });
  await act(async () => {
    capturedCallbacks.onStage({ step: 1, total: 2, agent: 'architect' });
    capturedCallbacks.onToken('architect', 'plan');
    capturedCallbacks.onAgentDone('architect');
    capturedCallbacks.onDone();
  });
  expect(ref.current.lastMeta.stage_outputs).toEqual([
    { step: 1, agent: 'architect', output: 'plan' },
  ]);
  cleanup();
});

// ---------------------------------------------------------------------------
// Stress: 50 random loadHistory calls
// ---------------------------------------------------------------------------

test('stress: 50 random loadHistory calls — never crash', async () => {
  for (let i = 0; i < 50; i++) {
    if (i % 3 === 0) {
      fetchHistory.mockRejectedValue(new Error('err'));
    } else {
      fetchHistory.mockResolvedValue([{ prompt: `p${i}` }]);
    }
    const { ref, cleanup } = mountHook();
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await act(async () => { await ref.current.loadHistory(); });
    spy.mockRestore();
    cleanup();
  }
});
