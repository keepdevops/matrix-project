/**
 * useSubmitHandlers tests.
 *
 * Covers:
 * - handleSubmit: basic submission, context policy injection for sessions
 * - handleSubmit: pipeline/cascade modes include 'final' in context
 * - handleSubmit: errors are caught and logged without throwing
 * - handleQualityPass: correct instruction and context policy
 * - handleFollowUp: followup flag + contextPolicy forwarded
 * - handleSendBestContinue: no-op when no flatPickAgent
 * - handleSaveCode: assembles code from agent responses
 * - pendingPrompt lifecycle (set on entry, cleared on exit)
 * - Stress: 50 random mode × session × opt combinations
 */
import { renderHook, act } from '@testing-library/react';
import { useSubmitHandlers } from './useSubmitHandlers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeHook(overrides = {}) {
  const submit = jest.fn().mockResolvedValue(undefined);
  const loadHistory = jest.fn().mockResolvedValue([]);
  const opts = {
    submit,
    loadHistory,
    currentSession: null,
    activeMode: 'flat',
    useRag: false,
    responses: {},
    activeAgents: [],
    flatPickAgent: null,
    ...overrides,
  };
  return { submit, loadHistory, opts };
}

// ---------------------------------------------------------------------------
// handleSubmit — basic
// ---------------------------------------------------------------------------

test('handleSubmit calls submit with prompt and temperature', async () => {
  const { submit, opts } = makeHook();
  const { result } = renderHook(() => useSubmitHandlers(opts));
  await act(async () => {
    await result.current.handleSubmit('hello', 0.3);
  });
  expect(submit).toHaveBeenCalledWith('hello', 0.3, expect.objectContaining({ useRag: false }));
});

test('handleSubmit clears pendingPrompt after completion', async () => {
  const { submit, opts } = makeHook();
  const { result } = renderHook(() => useSubmitHandlers(opts));
  await act(async () => {
    await result.current.handleSubmit('x', 0.2);
  });
  expect(result.current.pendingPrompt).toBeNull();
});

test('handleSubmit does not throw on submit error', async () => {
  const submit = jest.fn().mockRejectedValue(new Error('network down'));
  const { opts } = makeHook({ submit });
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  const { result } = renderHook(() => useSubmitHandlers(opts));
  await act(async () => {
    await expect(result.current.handleSubmit('p', 0.2)).resolves.toBeUndefined();
  });
  expect(spy).toHaveBeenCalled();
  spy.mockRestore();
});

// ---------------------------------------------------------------------------
// handleSubmit — session context policy injection
// ---------------------------------------------------------------------------

test('handleSubmit injects followup + contextPolicy for existing session (flat mode)', async () => {
  const { submit, opts } = makeHook({
    currentSession: { sessionId: 'abc', runId: 'r1' },
    activeMode: 'flat',
  });
  const { result } = renderHook(() => useSubmitHandlers(opts));
  await act(async () => { await result.current.handleSubmit('q', 0.2); });
  const callOpts = submit.mock.calls[0][2];
  expect(callOpts.followup).toBe(true);
  expect(callOpts.contextPolicy.include).toContain('original_prompt');
  expect(callOpts.contextPolicy.include).not.toContain('final');
});

test('handleSubmit includes final in contextPolicy for pipeline mode', async () => {
  const { submit, opts } = makeHook({
    currentSession: { sessionId: 'abc', runId: 'r1' },
    activeMode: 'pipeline',
  });
  const { result } = renderHook(() => useSubmitHandlers(opts));
  await act(async () => { await result.current.handleSubmit('q', 0.2); });
  const callOpts = submit.mock.calls[0][2];
  expect(callOpts.contextPolicy.include).toContain('final');
});

test('handleSubmit includes final in contextPolicy for cascade mode', async () => {
  const { submit, opts } = makeHook({
    currentSession: { sessionId: 'abc', runId: 'r1' },
    activeMode: 'cascade',
  });
  const { result } = renderHook(() => useSubmitHandlers(opts));
  await act(async () => { await result.current.handleSubmit('q', 0.2); });
  const callOpts = submit.mock.calls[0][2];
  expect(callOpts.contextPolicy.include).toContain('final');
});

test('handleSubmit does NOT inject followup when no currentSession', async () => {
  const { submit, opts } = makeHook({ currentSession: null });
  const { result } = renderHook(() => useSubmitHandlers(opts));
  await act(async () => { await result.current.handleSubmit('q', 0.2); });
  const callOpts = submit.mock.calls[0][2];
  expect(callOpts.followup).toBeUndefined();
});

// ---------------------------------------------------------------------------
// handleQualityPass
// ---------------------------------------------------------------------------

test('handleQualityPass sends correct instruction with qualityPass flag', async () => {
  const { submit, opts } = makeHook({ activeMode: 'pipeline' });
  const { result } = renderHook(() => useSubmitHandlers(opts));
  await act(async () => { await result.current.handleQualityPass(0.2); });
  const [prompt, , callOpts] = submit.mock.calls[0];
  expect(prompt).toMatch(/compile errors/);
  expect(callOpts.qualityPass).toBe(true);
  expect(callOpts.followup).toBe(true);
});

// ---------------------------------------------------------------------------
// handleFollowUp
// ---------------------------------------------------------------------------

test('handleFollowUp calls submit with followup=true and contextPolicy', async () => {
  const { submit, opts } = makeHook();
  const policy = { include: ['original_prompt'] };
  const { result } = renderHook(() => useSubmitHandlers(opts));
  await act(async () => { await result.current.handleFollowUp('continue', policy); });
  const callOpts = submit.mock.calls[0][2];
  expect(callOpts.followup).toBe(true);
  expect(callOpts.contextPolicy).toBe(policy);
});

// ---------------------------------------------------------------------------
// handleSendBestContinue
// ---------------------------------------------------------------------------

test('handleSendBestContinue is no-op when flatPickAgent is null', async () => {
  const { submit, opts } = makeHook({ flatPickAgent: null });
  const { result } = renderHook(() => useSubmitHandlers(opts));
  await act(async () => { await result.current.handleSendBestContinue(); });
  expect(submit).not.toHaveBeenCalled();
});

test('handleSendBestContinue is no-op when flatPickAgent response missing', async () => {
  const { submit, opts } = makeHook({ flatPickAgent: 'programmer', responses: {} });
  const { result } = renderHook(() => useSubmitHandlers(opts));
  await act(async () => { await result.current.handleSendBestContinue(); });
  expect(submit).not.toHaveBeenCalled();
});

test('handleSendBestContinue submits refine prompt with correct context policy', async () => {
  const { submit, opts } = makeHook({
    flatPickAgent: 'programmer',
    responses: { programmer: 'some code' },
  });
  const { result } = renderHook(() => useSubmitHandlers(opts));
  await act(async () => { await result.current.handleSendBestContinue(0.2); });
  const [, , callOpts] = submit.mock.calls[0];
  expect(callOpts.contextPolicy.target_agent).toBe('programmer');
  expect(callOpts.contextPolicy.include).toContain('programmer');
});

// ---------------------------------------------------------------------------
// handleSaveCode
// ---------------------------------------------------------------------------

test('handleSaveCode does nothing when no agents have responses', () => {
  const onSaveCodeToast = jest.fn();
  const { opts } = makeHook({
    activeAgents: [{ name: 'architect' }],
    responses: {},
    onSaveCodeToast,
  });
  const { result } = renderHook(() => useSubmitHandlers(opts));
  act(() => result.current.handleSaveCode());
  expect(onSaveCodeToast).toHaveBeenCalledWith(expect.stringContaining('No fenced'), 'warn');
});

test('handleSaveCode downloads combined code from programmer fence', () => {
  const origCreateElement = document.createElement.bind(document);
  const createObjectURL = jest.fn(() => 'blob:mock');
  const revokeObjectURL = jest.fn();
  global.URL.createObjectURL = createObjectURL;
  global.URL.revokeObjectURL = revokeObjectURL;

  const click = jest.fn();
  const spy = jest.spyOn(document, 'createElement').mockImplementation((tag) => {
    if (tag === 'a') return { click, download: '', href: '' };
    return origCreateElement(tag);
  });

  const { opts } = makeHook({
    activeAgents: [{ name: 'programmer' }],
    responses: { programmer: '```python\nprint("ok")\n```' },
    onSaveCodeToast: jest.fn(),
  });
  const { result } = renderHook(() => useSubmitHandlers(opts));
  act(() => result.current.handleSaveCode());

  expect(createObjectURL).toHaveBeenCalled();
  const blob = createObjectURL.mock.calls[0][0];
  expect(blob.type).toBe('text/plain');
  expect(click).toHaveBeenCalled();
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock');
  expect(opts.onSaveCodeToast).toHaveBeenCalledWith(expect.stringContaining('Saved'), 'success');

  spy.mockRestore();
});

test('handleSubmit forwards useRag and rag opts from PromptInput merge', async () => {
  const { submit, opts } = makeHook({ useRag: true });
  const { result } = renderHook(() => useSubmitHandlers(opts));
  await act(async () => {
    await result.current.handleSubmit('write fib in python', 0.2, { ragTopK: 5 });
  });
  expect(submit).toHaveBeenCalledWith(
    'write fib in python',
    0.2,
    expect.objectContaining({ useRag: true, ragTopK: 5 }),
  );
});

// ---------------------------------------------------------------------------
// Empty / whitespace prompts
// ---------------------------------------------------------------------------

test('handleSubmit passes empty string prompt through to submit', async () => {
  const { submit, opts } = makeHook();
  const { result } = renderHook(() => useSubmitHandlers(opts));
  await act(async () => { await result.current.handleSubmit('', 0.3); });
  expect(submit).toHaveBeenCalledWith('', 0.3, expect.any(Object));
});

test('handleSubmit passes whitespace-only prompt through to submit', async () => {
  const { submit, opts } = makeHook();
  const { result } = renderHook(() => useSubmitHandlers(opts));
  await act(async () => { await result.current.handleSubmit('   ', 0.3); });
  expect(submit).toHaveBeenCalledWith('   ', 0.3, expect.any(Object));
});

test('handleFollowUp passes empty string through without throwing', async () => {
  const { submit, opts } = makeHook();
  const { result } = renderHook(() => useSubmitHandlers(opts));
  const policy = { include: ['original_prompt'] };
  await act(async () => { await result.current.handleFollowUp('', policy); });
  expect(submit).toHaveBeenCalledWith('', expect.any(Number), expect.objectContaining({ followup: true }));
});

// ---------------------------------------------------------------------------
// Special characters in prompts
// ---------------------------------------------------------------------------

const SPECIAL_PROMPTS = [
  'Hello\nworld',                          // newlines
  'Tab\there',                             // tabs
  '<script>alert("xss")</script>',         // HTML/XSS
  "It's a \"test\" with 'quotes'",         // mixed quotes
  '{"key": "value", "n": 42}',            // JSON-like
  'prompt; rm -rf /',                      // shell injection attempt
  '日本語テスト',                            // unicode / CJK
  '🔥 emoji prompt 🚀',                   // emoji
  'a'.repeat(5000),                        // very long prompt
  '\x00\x01\x1f',                          // control characters
];

test.each(SPECIAL_PROMPTS)(
  'handleSubmit passes special prompt through without throwing: %s',
  async (prompt) => {
    const { submit, opts } = makeHook();
    const { result } = renderHook(() => useSubmitHandlers(opts));
    await act(async () => { await result.current.handleSubmit(prompt, 0.3); });
    expect(submit).toHaveBeenCalledWith(prompt, 0.3, expect.any(Object));
  }
);

test('handleSubmit with special chars still clears pendingPrompt', async () => {
  const { submit, opts } = makeHook();
  const { result } = renderHook(() => useSubmitHandlers(opts));
  await act(async () => { await result.current.handleSubmit('<b>bold</b>', 0.2); });
  expect(submit).toHaveBeenCalled();
  expect(result.current.pendingPrompt).toBeNull();
});

// ---------------------------------------------------------------------------
// Stress: 50 random mode × session combinations
// ---------------------------------------------------------------------------

const MODES = ['flat', 'pipeline', 'cascade', 'router'];

test('stress: 50 random mode×session combos never throw', async () => {
  for (let i = 0; i < 50; i++) {
    const activeMode = MODES[i % MODES.length];
    const hasSession = i % 2 === 0;
    const { submit, loadHistory, opts } = makeHook({
      activeMode,
      currentSession: hasSession ? { sessionId: `s${i}`, runId: `r${i}` } : null,
    });
    const { result } = renderHook(() => useSubmitHandlers(opts));
    await act(async () => {
      await result.current.handleSubmit(`prompt-${i}`, 0.2 + (i % 5) * 0.1);
    });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(loadHistory).toHaveBeenCalledTimes(1);
  }
});
