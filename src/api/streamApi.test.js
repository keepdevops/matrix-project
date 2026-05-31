/* eslint-disable no-undef */
// TextDecoder / TextEncoder are in Node's util but not exposed by jest-jsdom.
const { TextDecoder: NodeTextDecoder } = require('util');
if (typeof global.TextDecoder === 'undefined') global.TextDecoder = NodeTextDecoder;

/**
 * streamApi tests.
 *
 * Covers:
 * - submitPromptStream: POSTs to /architect/stream, calls onToken/onDone
 * - submitPromptStream: calls onError on non-ok response
 * - submitPromptStream: abort via cancel function calls no callbacks
 * - submitPromptStream: optional opts (sessionId, followup, useRag) included in body
 * - submitPromptStream: per-agent onError dispatched for error SSE events
 * - submitPromptStream: onSession dispatched for session SSE event
 * - submitPromptStreamMlx: POSTs to MLX endpoint, maps agent_id field
 * - submitPromptStreamMlx: abort is clean
 * - Stress: 50 random prompt/temperature combos all call fetch once each
 */
import { submitPromptStream, submitPromptStreamMlx } from './streamApi';

// ---------------------------------------------------------------------------
// Helpers — reader mock (avoids TextEncoder / ReadableStream in jsdom)
// ---------------------------------------------------------------------------

function makeReader(blocks) {
  // Each block is a plain string; Buffer.from() produces a Uint8Array-compatible
  // buffer that TextDecoder can decode — no TextEncoder or ReadableStream needed.
  let idx = 0;
  return {
    async read() {
      if (idx < blocks.length) return { done: false, value: Buffer.from(blocks[idx++]) };
      return { done: true, value: undefined };
    },
  };
}

function sseBlock(eventName, data) {
  return `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
}

function mockFetchOk(blocks) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    body: { getReader: () => makeReader(blocks) },
  });
}

function mockFetchError(status, text) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: false,
    status,
    text: jest.fn().mockResolvedValue(text),
  });
}

// ---------------------------------------------------------------------------
// submitPromptStream — happy path
// ---------------------------------------------------------------------------

test('programmer token stream assembles extractable python block', async () => {
  const { extractCodeBlock } = require('../utils/codeExtractor');
  mockFetchOk([
    sseBlock('token', { agent: 'programmer', delta: '```python\n' }),
    sseBlock('token', { agent: 'programmer', delta: 'def hi():\n  return 1\n' }),
    sseBlock('token', { agent: 'programmer', delta: '```\n' }),
    sseBlock('done', {}),
  ]);
  const chunks = [];
  const onToken = (agent, delta) => {
    if (agent === 'programmer') chunks.push(delta);
  };
  submitPromptStream('write hi in python', 0.2, {}, { onToken, onDone: jest.fn() });
  await new Promise(r => setTimeout(r, 50));
  const { code, language } = extractCodeBlock(chunks.join(''));
  expect(language).toBe('python');
  expect(code).toContain('def hi');
});

test('submitPromptStream calls onToken and onDone on valid SSE', async () => {
  mockFetchOk([
    sseBlock('token', { agent: 'programmer', delta: 'hello ' }),
    sseBlock('token', { agent: 'programmer', delta: 'world' }),
    sseBlock('done', {}),
  ]);
  const onToken = jest.fn();
  const onDone = jest.fn();
  submitPromptStream('test prompt', 0.2, {}, { onToken, onDone });
  await new Promise(r => setTimeout(r, 50));
  expect(onToken).toHaveBeenCalledWith('programmer', 'hello ');
  expect(onToken).toHaveBeenCalledWith('programmer', 'world');
  expect(onDone).toHaveBeenCalled();
});

test('submitPromptStream dispatches onSession event', async () => {
  mockFetchOk([
    sseBlock('session', { session_id: 's1', run_id: 'r1' }),
    sseBlock('done', {}),
  ]);
  const onSession = jest.fn();
  const onDone = jest.fn();
  submitPromptStream('q', 0.2, {}, { onSession, onDone });
  await new Promise(r => setTimeout(r, 50));
  expect(onSession).toHaveBeenCalledWith({ session_id: 's1', run_id: 'r1' });
});

test('submitPromptStream dispatches per-agent onError for error event', async () => {
  mockFetchOk([
    sseBlock('error', { agent: 'reviewer', error: 'OOM' }),
    sseBlock('done', {}),
  ]);
  const onError = jest.fn();
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  submitPromptStream('q', 0.2, {}, { onError, onDone: jest.fn() });
  await new Promise(r => setTimeout(r, 50));
  expect(onError).toHaveBeenCalledWith('reviewer', 'OOM');
  spy.mockRestore();
});

// ---------------------------------------------------------------------------
// submitPromptStream — error handling
// ---------------------------------------------------------------------------

test('submitPromptStream calls onError on non-ok HTTP response', async () => {
  mockFetchError(500, 'Internal Server Error');
  const onError = jest.fn();
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  submitPromptStream('q', 0.2, {}, { onError });
  await new Promise(r => setTimeout(r, 50));
  expect(onError).toHaveBeenCalledWith(null, 'Internal Server Error');
  spy.mockRestore();
});

test('submitPromptStream calls onError on fetch network failure', async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
  const onError = jest.fn();
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  submitPromptStream('q', 0.2, {}, { onError });
  await new Promise(r => setTimeout(r, 50));
  expect(onError).toHaveBeenCalledWith(null, 'ECONNREFUSED');
  spy.mockRestore();
});

// ---------------------------------------------------------------------------
// submitPromptStream — cancel / abort
// ---------------------------------------------------------------------------

test('submitPromptStream cancel function aborts without calling onError', async () => {
  // Fetch that never resolves
  global.fetch = jest.fn().mockImplementation(() => new Promise(() => {}));
  const onError = jest.fn();
  const cancel = submitPromptStream('q', 0.2, {}, { onError });
  cancel();
  await new Promise(r => setTimeout(r, 10));
  expect(onError).not.toHaveBeenCalled();
});

// ---------------------------------------------------------------------------
// submitPromptStream — request body opts
// ---------------------------------------------------------------------------

test('submitPromptStream includes sessionId and followup in body', async () => {
  mockFetchOk([sseBlock('done', {})]);
  submitPromptStream('q', 0.3, { sessionId: 's1', followup: true }, { onDone: jest.fn() });
  await new Promise(r => setTimeout(r, 50));
  const body = JSON.parse(global.fetch.mock.calls[0][1].body);
  expect(body.session_id).toBe('s1');
  expect(body.followup).toBe(true);
});

test('submitPromptStream includes useRag and ragTopK in body', async () => {
  mockFetchOk([sseBlock('done', {})]);
  submitPromptStream('q', 0.2, { useRag: true, ragTopK: 5 }, { onDone: jest.fn() });
  await new Promise(r => setTimeout(r, 50));
  const body = JSON.parse(global.fetch.mock.calls[0][1].body);
  expect(body.use_rag).toBe(true);
  expect(body.rag_top_k).toBe(5);
});

// ---------------------------------------------------------------------------
// submitPromptStreamMlx — happy path
// ---------------------------------------------------------------------------

test('submitPromptStreamMlx calls onToken with agent_id and onDone', async () => {
  mockFetchOk([
    sseBlock('token', { agent_id: 'scout', text: 'analysis' }),
    sseBlock('done', {}),
  ]);
  const onToken = jest.fn();
  const onDone = jest.fn();
  submitPromptStreamMlx('q', 0.2, {}, { onToken, onDone });
  await new Promise(r => setTimeout(r, 50));
  expect(onToken).toHaveBeenCalledWith('scout', 'analysis');
  expect(onDone).toHaveBeenCalled();
});

test('submitPromptStreamMlx cancel is clean', async () => {
  global.fetch = jest.fn().mockImplementation(() => new Promise(() => {}));
  const onError = jest.fn();
  const cancel = submitPromptStreamMlx('q', 0.2, {}, { onError });
  cancel();
  await new Promise(r => setTimeout(r, 10));
  expect(onError).not.toHaveBeenCalled();
});

// ---------------------------------------------------------------------------
// Token SSE events
// ---------------------------------------------------------------------------

test('submitPromptStream fires onAgentDone when agent_done event received', async () => {
  mockFetchOk([
    sseBlock('token', { agent: 'programmer', delta: 'hi' }),
    sseBlock('agent_done', { agent: 'programmer' }),
    sseBlock('done', {}),
  ]);
  const onAgentDone = jest.fn();
  submitPromptStream('q', 0.2, {}, { onToken: jest.fn(), onAgentDone, onDone: jest.fn() });
  await new Promise(r => setTimeout(r, 50));
  expect(onAgentDone).toHaveBeenCalledWith('programmer');
});

test('submitPromptStream fires onSelected event', async () => {
  mockFetchOk([
    sseBlock('selected', { agent: 'reviewer', score: 0.92 }),
    sseBlock('done', {}),
  ]);
  const onSelected = jest.fn();
  submitPromptStream('q', 0.2, {}, { onSelected, onDone: jest.fn() });
  await new Promise(r => setTimeout(r, 50));
  expect(onSelected).toHaveBeenCalledWith({ agent: 'reviewer', score: 0.92 });
});

test('submitPromptStream fires onStage event', async () => {
  mockFetchOk([
    sseBlock('stage', { stage: 'synthesis' }),
    sseBlock('done', {}),
  ]);
  const onStage = jest.fn();
  submitPromptStream('q', 0.2, {}, { onStage, onDone: jest.fn() });
  await new Promise(r => setTimeout(r, 50));
  expect(onStage).toHaveBeenCalledWith({ stage: 'synthesis' });
});

test('submitPromptStream fires onMetrics with per-agent timings', async () => {
  const metrics = {
    programmer: { calls: 1, total_ms: 1200, completion_tokens: 80 },
    reviewer: { calls: 1, total_ms: 400, completion_tokens: 20 },
  };
  mockFetchOk([
    sseBlock('metrics', metrics),
    sseBlock('done', {}),
  ]);
  const onMetrics = jest.fn();
  submitPromptStream('q', 0.2, {}, { onMetrics, onDone: jest.fn() });
  await new Promise(r => setTimeout(r, 50));
  expect(onMetrics).toHaveBeenCalledWith(metrics);
});

test('submitPromptStream fires onSynthesisStart event', async () => {
  mockFetchOk([
    sseBlock('synthesis_start', { agent: 'architect' }),
    sseBlock('done', {}),
  ]);
  const onSynthesisStart = jest.fn();
  submitPromptStream('q', 0.2, {}, { onSynthesisStart, onDone: jest.fn() });
  await new Promise(r => setTimeout(r, 50));
  expect(onSynthesisStart).toHaveBeenCalledWith('architect');
});

test('submitPromptStream accumulates tokens from multiple agents in order', async () => {
  mockFetchOk([
    sseBlock('token', { agent: 'programmer', delta: 'foo' }),
    sseBlock('token', { agent: 'reviewer', delta: 'bar' }),
    sseBlock('token', { agent: 'programmer', delta: 'baz' }),
    sseBlock('done', {}),
  ]);
  const calls = [];
  submitPromptStream('q', 0.2, {}, { onToken: (a, d) => calls.push([a, d]), onDone: jest.fn() });
  await new Promise(r => setTimeout(r, 50));
  expect(calls).toEqual([
    ['programmer', 'foo'],
    ['reviewer', 'bar'],
    ['programmer', 'baz'],
  ]);
});

test('submitPromptStream handles token with empty delta string', async () => {
  mockFetchOk([
    sseBlock('token', { agent: 'programmer', delta: '' }),
    sseBlock('done', {}),
  ]);
  const onToken = jest.fn();
  submitPromptStream('q', 0.2, {}, { onToken, onDone: jest.fn() });
  await new Promise(r => setTimeout(r, 50));
  expect(onToken).toHaveBeenCalledWith('programmer', '');
});

test('submitPromptStream handles token delta with special characters', async () => {
  const delta = '<b>bold</b> & "quoted" \n 日本語';
  mockFetchOk([
    sseBlock('token', { agent: 'architect', delta }),
    sseBlock('done', {}),
  ]);
  const onToken = jest.fn();
  submitPromptStream('q', 0.2, {}, { onToken, onDone: jest.fn() });
  await new Promise(r => setTimeout(r, 50));
  expect(onToken).toHaveBeenCalledWith('architect', delta);
});

test('submitPromptStream fires onDone when stream ends without explicit done event', async () => {
  mockFetchOk([
    sseBlock('token', { agent: 'programmer', delta: 'x' }),
    // no done block — reader will return done:true
  ]);
  const onDone = jest.fn();
  submitPromptStream('q', 0.2, {}, { onToken: jest.fn(), onDone });
  await new Promise(r => setTimeout(r, 50));
  expect(onDone).toHaveBeenCalled();
});

test('submitPromptStreamMlx fires onAgentDone on agent_end event', async () => {
  mockFetchOk([
    sseBlock('token', { agent_id: 'scout', text: 'hello' }),
    sseBlock('agent_end', { agent_id: 'scout' }),
    sseBlock('done', {}),
  ]);
  const onAgentDone = jest.fn();
  submitPromptStreamMlx('q', 0.2, {}, { onToken: jest.fn(), onAgentDone, onDone: jest.fn() });
  await new Promise(r => setTimeout(r, 50));
  expect(onAgentDone).toHaveBeenCalledWith('scout');
});

// ---------------------------------------------------------------------------
// Empty / whitespace prompts
// ---------------------------------------------------------------------------

test('submitPromptStream sends empty string prompt in request body', async () => {
  mockFetchOk([sseBlock('done', {})]);
  submitPromptStream('', 0.2, {}, { onDone: jest.fn() });
  await new Promise(r => setTimeout(r, 50));
  const body = JSON.parse(global.fetch.mock.calls[0][1].body);
  expect(body.prompt).toBe('');
});

test('submitPromptStream sends whitespace-only prompt in request body', async () => {
  mockFetchOk([sseBlock('done', {})]);
  submitPromptStream('   ', 0.2, {}, { onDone: jest.fn() });
  await new Promise(r => setTimeout(r, 50));
  const body = JSON.parse(global.fetch.mock.calls[0][1].body);
  expect(body.prompt).toBe('   ');
});

// ---------------------------------------------------------------------------
// Special characters in prompts
// ---------------------------------------------------------------------------

const SPECIAL_PROMPTS = [
  ['newlines',          'Hello\nworld'],
  ['tabs',              'Tab\there'],
  ['html/xss',          '<script>alert("xss")</script>'],
  ['mixed quotes',      "It's a \"test\" with 'quotes'"],
  ['json-like',         '{"key": "value"}'],
  ['shell injection',   'prompt; rm -rf /'],
  ['unicode/CJK',       '日本語テスト'],
  ['emoji',             '🔥 emoji 🚀'],
  ['very long (5000)',  'a'.repeat(5000)],
  ['control chars',     '\x00\x01\x1f'],
];

test.each(SPECIAL_PROMPTS)(
  'submitPromptStream round-trips special prompt (%s) intact in request body',
  async (_label, prompt) => {
    mockFetchOk([sseBlock('done', {})]);
    submitPromptStream(prompt, 0.2, {}, { onDone: jest.fn() });
    await new Promise(r => setTimeout(r, 50));
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.prompt).toBe(prompt);
  }
);

// ---------------------------------------------------------------------------
// Stress: 50 random prompt/temperature combos
// ---------------------------------------------------------------------------

test('stress: 50 random submit calls each POST to the stream endpoint once', async () => {
  for (let i = 0; i < 50; i++) {
    mockFetchOk([sseBlock('done', {})]);
    const onDone = jest.fn();
    submitPromptStream(`prompt-${i}`, 0.1 + (i % 9) * 0.1, {}, { onDone });
    await new Promise(r => setTimeout(r, 20));
    expect(global.fetch).toHaveBeenCalledTimes(1);
  }
});
