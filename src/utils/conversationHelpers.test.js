/**
 * conversationHelpers tests.
 *
 * Covers:
 * - bestAgentText: longest agent string, metadata keys ignored, empty/null values
 * - buildSessionList: grouping, counting, sorting, missing session_id skipped
 */
import { bestAgentText, buildSessionList } from './conversationHelpers';

// ---------------------------------------------------------------------------
// bestAgentText
// ---------------------------------------------------------------------------

test('returns the agent string when only one agent key present', () => {
  expect(bestAgentText({ prompt: 'q', programmer: 'hello world' })).toBe('hello world');
});

test('returns the longest agent string when multiple agents present', () => {
  const entry = { programmer: 'short', reviewer: 'a much longer response here', tester: 'mid' };
  expect(bestAgentText(entry)).toBe('a much longer response here');
});

test('returns null when only metadata keys present', () => {
  const entry = { prompt: 'q', temperature: 0.2, timestamp: 1000, _final: 'x', _mode: 'flat' };
  expect(bestAgentText(entry)).toBeNull();
});

test('returns null when all agent values are empty strings', () => {
  expect(bestAgentText({ programmer: '', reviewer: '' })).toBeNull();
});

test('ignores metadata keys even when they have long values', () => {
  const entry = { prompt: 'a very long prompt string indeed', programmer: 'hi' };
  expect(bestAgentText(entry)).toBe('hi');
});

test('ignores non-string agent values', () => {
  const entry = { programmer: 42, reviewer: null, tester: 'actual text' };
  expect(bestAgentText(entry)).toBe('actual text');
});

test('returns null for empty entry object', () => {
  expect(bestAgentText({})).toBeNull();
});

// ---------------------------------------------------------------------------
// buildSessionList
// ---------------------------------------------------------------------------

test('returns [] for empty history', () => {
  expect(buildSessionList([])).toEqual([]);
});

test('skips entries with no _session_id', () => {
  const history = [{ prompt: 'q', programmer: 'hi' }];
  expect(buildSessionList(history)).toEqual([]);
});

test('groups entries by _session_id and counts them', () => {
  const history = [
    { _session_id: 's1', prompt: 'first', timestamp: 1000 },
    { _session_id: 's1', prompt: 'second', timestamp: 1001 },
    { _session_id: 's1', timestamp: 1002 },
  ];
  const result = buildSessionList(history);
  expect(result).toHaveLength(1);
  expect(result[0].sessionId).toBe('s1');
  expect(result[0].count).toBe(3);
  expect(result[0].firstPrompt).toBe('first');
});

test('multiple sessions are each counted independently', () => {
  const history = [
    { _session_id: 's1', prompt: 'p1', timestamp: 2000 },
    { _session_id: 's2', prompt: 'p2', timestamp: 1000 },
    { _session_id: 's2', timestamp: 1001 },
  ];
  const result = buildSessionList(history);
  expect(result).toHaveLength(2);
  const s1 = result.find(r => r.sessionId === 's1');
  const s2 = result.find(r => r.sessionId === 's2');
  expect(s1.count).toBe(1);
  expect(s2.count).toBe(2);
});

test('sorts most-recent-first by timestamp', () => {
  const history = [
    { _session_id: 's1', timestamp: 1000 },
    { _session_id: 's3', timestamp: 3000 },
    { _session_id: 's2', timestamp: 2000 },
  ];
  const result = buildSessionList(history);
  expect(result.map(r => r.sessionId)).toEqual(['s3', 's2', 's1']);
});

test('entries missing timestamp sort behind entries with timestamps', () => {
  const history = [
    { _session_id: 'sA' },             // no timestamp → 0
    { _session_id: 'sB', timestamp: 500 },
  ];
  const result = buildSessionList(history);
  expect(result[0].sessionId).toBe('sB');
  expect(result[1].sessionId).toBe('sA');
});

test('firstPrompt defaults to empty string when prompt is missing', () => {
  const history = [{ _session_id: 's1', timestamp: 1 }];
  expect(buildSessionList(history)[0].firstPrompt).toBe('');
});
