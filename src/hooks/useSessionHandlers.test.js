/**
 * useSessionHandlers tests.
 *
 * Covers:
 * - handleHistorySelect: extracts responses, sets finalAnswer, selectedPrompt, closes history
 * - handleHistorySelect: skips metadata keys
 * - handleHistorySelect: restores session when _session_id/_run_id present
 * - handleHistorySelect: defaults selectedTemperature to 0.7 when not in entry
 * - handleSwitchSession: no-op when sessionId not found in history
 * - handleSwitchSession: finds last entry, updates session
 * - handleClearSession: resets all session state
 * - showHistory toggle via setShowHistory
 * - Stress: 50 random history entries never throw
 */
import { renderHook, act } from '@testing-library/react';
import { useSessionHandlers } from './useSessionHandlers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const METADATA_KEYS = ['prompt', 'temperature', 'timestamp', '_final', '_mode', '_session_id', '_run_id'];

function makeSetters() {
  return {
    setResponses:     jest.fn(),
    setFinalAnswer:   jest.fn(),
    setLastMeta:      jest.fn(),
    setCurrentSession: jest.fn(),
  };
}

function makeOpts(historyOverride = [], setterOverrides = {}) {
  return {
    history: historyOverride,
    ...makeSetters(),
    ...setterOverrides,
  };
}

// ---------------------------------------------------------------------------
// handleHistorySelect
// ---------------------------------------------------------------------------

test('handleHistorySelect extracts non-metadata keys as responses', () => {
  const opts = makeOpts();
  const entry = { prompt: 'q', temperature: 0.3, programmer: 'some code', reviewer: 'looks good' };
  const { result } = renderHook(() => useSessionHandlers(opts));
  act(() => { result.current.handleHistorySelect(entry); });
  expect(opts.setResponses).toHaveBeenCalledWith({ programmer: 'some code', reviewer: 'looks good' });
});

test('handleHistorySelect sets finalAnswer from _final', () => {
  const opts = makeOpts();
  const entry = { prompt: 'q', _final: 'the final answer', temperature: 0.2 };
  const { result } = renderHook(() => useSessionHandlers(opts));
  act(() => { result.current.handleHistorySelect(entry); });
  expect(opts.setFinalAnswer).toHaveBeenCalledWith('the final answer');
});

test('handleHistorySelect falls back to null finalAnswer', () => {
  const opts = makeOpts();
  const { result } = renderHook(() => useSessionHandlers(opts));
  act(() => { result.current.handleHistorySelect({ prompt: 'q' }); });
  expect(opts.setFinalAnswer).toHaveBeenCalledWith(null);
});

test('handleHistorySelect sets selectedPrompt', () => {
  const opts = makeOpts();
  const { result } = renderHook(() => useSessionHandlers(opts));
  act(() => { result.current.handleHistorySelect({ prompt: 'my question', temperature: 0.5 }); });
  expect(result.current.selectedPrompt).toBe('my question');
});

test('handleHistorySelect defaults selectedTemperature to 0.7 when absent', () => {
  const opts = makeOpts();
  const { result } = renderHook(() => useSessionHandlers(opts));
  act(() => { result.current.handleHistorySelect({ prompt: 'q' }); });
  expect(result.current.selectedTemperature).toBe(0.7);
});

test('handleHistorySelect uses entry temperature when present', () => {
  const opts = makeOpts();
  const { result } = renderHook(() => useSessionHandlers(opts));
  act(() => { result.current.handleHistorySelect({ prompt: 'q', temperature: 0.4 }); });
  expect(result.current.selectedTemperature).toBe(0.4);
});

test('handleHistorySelect restores currentSession when ids present', () => {
  const opts = makeOpts();
  const entry = { prompt: 'q', _session_id: 's1', _run_id: 'r1' };
  const { result } = renderHook(() => useSessionHandlers(opts));
  act(() => { result.current.handleHistorySelect(entry); });
  expect(opts.setCurrentSession).toHaveBeenCalledWith({ sessionId: 's1', runId: 'r1' });
});

test('handleHistorySelect does not set currentSession when ids missing', () => {
  const opts = makeOpts();
  const { result } = renderHook(() => useSessionHandlers(opts));
  act(() => { result.current.handleHistorySelect({ prompt: 'q' }); });
  expect(opts.setCurrentSession).not.toHaveBeenCalled();
});

test('handleHistorySelect closes history panel', () => {
  const opts = makeOpts();
  const { result } = renderHook(() => useSessionHandlers(opts));
  act(() => { result.current.setShowHistory(true); });
  act(() => { result.current.handleHistorySelect({ prompt: 'q' }); });
  expect(result.current.showHistory).toBe(false);
});

test('handleHistorySelect skips all metadata keys from responses', () => {
  const opts = makeOpts();
  const entry = {};
  METADATA_KEYS.forEach(k => { entry[k] = `val-${k}`; });
  entry.architect = 'design doc';
  const { result } = renderHook(() => useSessionHandlers(opts));
  act(() => { result.current.handleHistorySelect(entry); });
  const calls = opts.setResponses.mock.calls[0][0];
  METADATA_KEYS.forEach(k => { expect(calls[k]).toBeUndefined(); });
  expect(calls.architect).toBe('design doc');
});

// ---------------------------------------------------------------------------
// handleSwitchSession
// ---------------------------------------------------------------------------

test('handleSwitchSession is no-op for unknown sessionId', () => {
  const history = [{ _session_id: 's1', _run_id: 'r1' }];
  const opts = makeOpts(history);
  const { result } = renderHook(() => useSessionHandlers(opts));
  act(() => { result.current.handleSwitchSession('s999'); });
  expect(opts.setCurrentSession).not.toHaveBeenCalled();
});

test('handleSwitchSession uses last matching entry', () => {
  const history = [
    { _session_id: 's1', _run_id: 'r1', _final: null },
    { _session_id: 's1', _run_id: 'r2', _final: 'answer' },
  ];
  const opts = makeOpts(history);
  const { result } = renderHook(() => useSessionHandlers(opts));
  act(() => { result.current.handleSwitchSession('s1'); });
  expect(opts.setCurrentSession).toHaveBeenCalledWith({ sessionId: 's1', runId: 'r2' });
  expect(opts.setFinalAnswer).toHaveBeenCalledWith('answer');
});

// ---------------------------------------------------------------------------
// handleClearSession
// ---------------------------------------------------------------------------

test('handleClearSession resets all session state', () => {
  const opts = makeOpts();
  const { result } = renderHook(() => useSessionHandlers(opts));
  act(() => { result.current.handleClearSession(); });
  expect(opts.setCurrentSession).toHaveBeenCalledWith(null);
  expect(opts.setResponses).toHaveBeenCalledWith({});
  expect(opts.setFinalAnswer).toHaveBeenCalledWith(null);
  expect(opts.setLastMeta).toHaveBeenCalledWith(null);
});

// ---------------------------------------------------------------------------
// Stress: 50 random history entries
// ---------------------------------------------------------------------------

test('stress: 50 random history entries never throw', () => {
  const roles = ['architect', 'programmer', 'reviewer', 'tester', 'security'];
  for (let i = 0; i < 50; i++) {
    const opts = makeOpts();
    const entry = {
      prompt: `p${i}`,
      temperature: Math.random(),
      _final: i % 3 === 0 ? `final-${i}` : undefined,
      _session_id: i % 2 === 0 ? `s${i}` : undefined,
      _run_id: i % 2 === 0 ? `r${i}` : undefined,
    };
    roles.slice(0, (i % roles.length) + 1).forEach(r => { entry[r] = `response-${r}-${i}`; });
    const { result } = renderHook(() => useSessionHandlers(opts));
    expect(() => {
      act(() => { result.current.handleHistorySelect(entry); });
    }).not.toThrow();
  }
});
