/**
 * base.js tests.
 *
 * Covers:
 * - normalizeArchitectResponse: envelope shape, flat-map shape, null/array/undefined input
 * - coalesce: concurrent callers share one in-flight promise; sequential calls get fresh ones
 */
import { normalizeArchitectResponse, coalesce } from './base';

// ---------------------------------------------------------------------------
// normalizeArchitectResponse
// ---------------------------------------------------------------------------

test('envelope shape: passes through mode, agents, final, meta', () => {
  const raw = { mode: 'flat', agents: { programmer: 'hi' }, final: 'done', meta: { ms: 100 } };
  expect(normalizeArchitectResponse(raw)).toEqual(raw);
});

test('envelope shape: missing final defaults to null', () => {
  const raw = { mode: 'pipeline', agents: { a: 'x' } };
  expect(normalizeArchitectResponse(raw).final).toBeNull();
});

test('envelope shape: missing meta defaults to {}', () => {
  const raw = { mode: 'flat', agents: { a: 'x' } };
  expect(normalizeArchitectResponse(raw).meta).toEqual({});
});

test('envelope shape: missing mode defaults to null', () => {
  const raw = { agents: { a: 'x' } };
  expect(normalizeArchitectResponse(raw).mode).toBeNull();
});

test('flat map (no .agents key): wraps in envelope', () => {
  const raw = { programmer: 'hello', reviewer: 'looks good' };
  const result = normalizeArchitectResponse(raw);
  expect(result.mode).toBeNull();
  expect(result.agents).toBe(raw);
  expect(result.final).toBeNull();
  expect(result.meta).toEqual({});
});

test('null input: returns safe defaults', () => {
  const result = normalizeArchitectResponse(null);
  expect(result).toEqual({ mode: null, agents: {}, final: null, meta: {} });
});

test('undefined input: returns safe defaults', () => {
  const result = normalizeArchitectResponse(undefined);
  expect(result).toEqual({ mode: null, agents: {}, final: null, meta: {} });
});

test('array input: treated as flat map (no .agents on array)', () => {
  const raw = ['a', 'b'];
  const result = normalizeArchitectResponse(raw);
  expect(result.mode).toBeNull();
  expect(result.agents).toBe(raw);
});

test('empty object: agents becomes {}, wrapped as flat map', () => {
  const result = normalizeArchitectResponse({});
  expect(result).toEqual({ mode: null, agents: {}, final: null, meta: {} });
});

// ---------------------------------------------------------------------------
// coalesce
// ---------------------------------------------------------------------------

test('coalesce: two concurrent calls share one in-flight promise (fn called once)', async () => {
  const fn = jest.fn().mockResolvedValue('result');
  const p1 = coalesce('key-concurrent', fn);
  const p2 = coalesce('key-concurrent', fn);
  expect(p1).toBe(p2);
  await p1;
  expect(fn).toHaveBeenCalledTimes(1);
});

test('coalesce: second call after first resolves gets a fresh promise (fn called twice)', async () => {
  const fn = jest.fn().mockResolvedValue('ok');
  await coalesce('key-sequential', fn);
  await coalesce('key-sequential', fn);
  expect(fn).toHaveBeenCalledTimes(2);
});

test('coalesce: different keys each call fn independently', async () => {
  const fn = jest.fn().mockResolvedValue('x');
  await Promise.all([
    coalesce('key-a', fn),
    coalesce('key-b', fn),
    coalesce('key-c', fn),
  ]);
  expect(fn).toHaveBeenCalledTimes(3);
});

test('coalesce: resolves to the value returned by fn', async () => {
  const result = await coalesce('key-value', () => Promise.resolve(42));
  expect(result).toBe(42);
});

test('coalesce: cleans up inflight entry after rejection', async () => {
  const fn = jest.fn()
    .mockRejectedValueOnce(new Error('fail'))
    .mockResolvedValue('ok');
  await expect(coalesce('key-reject', fn)).rejects.toThrow('fail');
  // After rejection, the key is cleared — next call invokes fn again
  const result = await coalesce('key-reject', fn);
  expect(result).toBe('ok');
  expect(fn).toHaveBeenCalledTimes(2);
});
