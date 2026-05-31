import { act, renderHook } from '@testing-library/react';
import { useSwarm } from './useSwarm';
import { runOrchestrateStream } from './useOrchestrateStream';

jest.mock('../api/orchestrateApi', () => ({
  submitOrchestrateStream: jest.fn(),
  saveOrchestrateHistory: jest.fn(() => Promise.resolve()),
}));

import { submitOrchestrateStream, saveOrchestrateHistory } from '../api/orchestrateApi';

beforeEach(() => {
  jest.clearAllMocks();
  submitOrchestrateStream.mockImplementation(() => () => {});
  saveOrchestrateHistory.mockImplementation(() => Promise.resolve());
  global.requestAnimationFrame = (cb) => { cb(); return 1; };
  global.cancelAnimationFrame = jest.fn();
});

test('runOrchestrateStream resolves with final text and saves history', async () => {
  let callbacks;
  submitOrchestrateStream.mockImplementation((_mode, _prompt, _params, _rag, cb) => {
    callbacks = cb;
    return () => {};
  });

  const cancelRef = { current: null };
  const setters = {
    setResponses: jest.fn(),
    setAgentErrors: jest.fn(),
    setFinalAnswer: jest.fn(),
    setLastMeta: jest.fn(),
    setLoading: jest.fn(),
    setError: jest.fn(),
  };

  let result;
  const p = runOrchestrateStream({
    prompt: 'design api',
    orchestrateMode: 'map_reduce',
    wallStart: Date.now(),
    cancelRef,
    ...setters,
  });

  await act(async () => {
    callbacks.onToken('worker', 'hello');
    callbacks.onDone({ result: 'hello', session_id: 's1', meta: { mode: 'map_reduce' } });
    result = await p;
  });

  expect(result.final).toBe('hello');
  expect(setters.setFinalAnswer).toHaveBeenCalledWith('hello');
  expect(setters.setLoading).toHaveBeenCalledWith(false);
  expect(saveOrchestrateHistory).toHaveBeenCalledWith({
    prompt: 'design api',
    result: 'hello',
    mode: 'map_reduce',
    sessionId: 's1',
  });
});

test('useSwarm submit delegates orchestrateMode to submitOrchestrateStream', async () => {
  let callbacks;
  submitOrchestrateStream.mockImplementation((_mode, _prompt, _params, _rag, cb) => {
    callbacks = cb;
    return () => {};
  });

  const { result, unmount } = renderHook(() => useSwarm());
  act(() => {
    result.current.submit('q', 0.2, { orchestrateMode: 'speculative' });
  });

  expect(submitOrchestrateStream).toHaveBeenCalled();
  await act(async () => {
    callbacks.onDone({ result: 'ok', meta: {} });
  });
  expect(result.current.finalAnswer).toBe('ok');
  unmount();
});
