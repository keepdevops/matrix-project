/**
 * RagSources + useRagHealth — pure logic tests.
 *
 * Covers: basename, formatDistance, rag prop normalization,
 * hit rendering decisions, health state transitions, polling lifecycle.
 */

// ---------------------------------------------------------------------------
// basename (replicated from RagSources.js)
// ---------------------------------------------------------------------------

function basename(p) {
  if (typeof p !== 'string' || !p) return '(unknown)';
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return idx >= 0 ? p.slice(idx + 1) : p;
}

describe('basename', () => {
  it.each([
    ['/docs/report.pdf',        'report.pdf'],
    ['/deep/nested/path/a.txt', 'a.txt'],
    ['relative/path/file.md',   'file.md'],
    ['C:\\Users\\me\\doc.docx', 'doc.docx'],
    ['just-a-name.txt',         'just-a-name.txt'],
    ['',                        '(unknown)'],
    [null,                      '(unknown)'],
    [undefined,                 '(unknown)'],
    [42,                        '(unknown)'],
  ])('basename(%s) === %s', (input, expected) => {
    expect(basename(input)).toBe(expected);
  });

  it('trailing slash returns empty component', () => {
    const result = basename('/path/');
    expect(result).toBe('');
  });

  it('handles Windows-style backslash', () => {
    expect(basename('C:\\folder\\model.gguf')).toBe('model.gguf');
  });
});

// ---------------------------------------------------------------------------
// formatDistance (replicated from RagSources.js)
// ---------------------------------------------------------------------------

function formatDistance(d) {
  if (typeof d !== 'number' || Number.isNaN(d)) return '—';
  return d.toFixed(4);
}

describe('formatDistance', () => {
  it.each([
    [0,         '0.0000'],
    [1,         '1.0000'],
    [0.1234567, '0.1235'],
    [0.9999,    '0.9999'],
    [1.5,       '1.5000'],
  ])('formatDistance(%s) === %s', (d, expected) => {
    expect(formatDistance(d)).toBe(expected);
  });

  it('returns em-dash for NaN', () => expect(formatDistance(NaN)).toBe('—'));
  it('returns em-dash for string', () => expect(formatDistance('0.5')).toBe('—'));
  it('returns em-dash for null', () => expect(formatDistance(null)).toBe('—'));
  it('returns em-dash for undefined', () => expect(formatDistance(undefined)).toBe('—'));
  it('negative distance formatted', () => expect(formatDistance(-0.1)).toBe('-0.1000'));
});

// ---------------------------------------------------------------------------
// RagSources rendering decisions
// ---------------------------------------------------------------------------

function ragRenderState(rag) {
  if (!rag || typeof rag !== 'object') return { render: false };
  if (!rag.requested) return { render: false };
  const hits = Array.isArray(rag.hits) ? rag.hits : [];
  const used = !!rag.used;
  const reason = typeof rag.reason === 'string' ? rag.reason : '';
  return { render: true, hits, used, reason };
}

describe('RagSources — render decisions', () => {
  it('null rag → no render', () => expect(ragRenderState(null).render).toBe(false));
  it('undefined rag → no render', () => expect(ragRenderState(undefined).render).toBe(false));
  it('non-object rag → no render', () => expect(ragRenderState('string').render).toBe(false));
  it('rag without requested → no render', () => {
    expect(ragRenderState({ hits: [] }).render).toBe(false);
  });
  it('rag.requested=false → no render', () => {
    expect(ragRenderState({ requested: false, hits: [] }).render).toBe(false);
  });
  it('rag.requested=true → renders', () => {
    expect(ragRenderState({ requested: true }).render).toBe(true);
  });
  it('no hits → used=false, hits=[]', () => {
    const s = ragRenderState({ requested: true, used: false });
    expect(s.used).toBe(false);
    expect(s.hits).toEqual([]);
  });
  it('hits present and used=true → shows table', () => {
    const s = ragRenderState({
      requested: true, used: true,
      hits: [{ source_path: '/a.txt', chunk_idx: 0, distance: 0.1 }],
    });
    expect(s.used).toBe(true);
    expect(s.hits).toHaveLength(1);
  });
  it('non-array hits normalised to empty', () => {
    const s = ragRenderState({ requested: true, used: true, hits: 'bad' });
    expect(s.hits).toEqual([]);
  });
  it('reason string forwarded', () => {
    const s = ragRenderState({ requested: true, used: false, reason: 'below threshold' });
    expect(s.reason).toBe('below threshold');
  });
  it('non-string reason normalised to empty', () => {
    const s = ragRenderState({ requested: true, used: false, reason: 42 });
    expect(s.reason).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Hit content expand state
// ---------------------------------------------------------------------------

describe('RagSources — hit content expandability', () => {
  function canExpand(h) {
    return typeof h.content === 'string' && h.content.trim().length > 0;
  }

  it('hit with content is expandable', () => {
    expect(canExpand({ content: 'some text' })).toBe(true);
  });
  it('hit with only whitespace is not expandable', () => {
    expect(canExpand({ content: '   ' })).toBe(false);
  });
  it('hit with empty string is not expandable', () => {
    expect(canExpand({ content: '' })).toBe(false);
  });
  it('hit without content key is not expandable', () => {
    expect(canExpand({})).toBe(false);
  });
  it('hit with null content is not expandable', () => {
    expect(canExpand({ content: null })).toBe(false);
  });
  it('long content is expandable', () => {
    expect(canExpand({ content: 'x'.repeat(10000) })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// useRagHealth — mock-based hook logic
// ---------------------------------------------------------------------------

jest.mock('../api/swarmApi', () => ({
  checkRagHealth: jest.fn(),
}));

import { checkRagHealth } from '../api/swarmApi';
import { act, renderHook } from '@testing-library/react';
import { useRagHealth } from '../hooks/useRagHealth';

function mountRagHealth(enabled = true) {
  const { result, rerender: rrHook, unmount } = renderHook(
    ({ enabled: e }) => useRagHealth(e),
    { initialProps: { enabled } },
  );
  return {
    stateRef: { get current() { return result.current; } },
    rerender: (newEnabled) => rrHook({ enabled: newEnabled }),
    cleanup: unmount,
  };
}

async function flush(ms = 0) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  checkRagHealth.mockResolvedValue({ ok: true, enabled: true, embedder: 'bge-m3' });
});

afterEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
});

describe('useRagHealth — initial state', () => {
  it('starts with loading=true', () => {
    const { stateRef, cleanup } = mountRagHealth(true);
    expect(stateRef.current.loading).toBe(true);
    cleanup();
  });

  it('ok=true after successful first poll', async () => {
    const { stateRef, cleanup } = mountRagHealth(true);
    await flush();
    expect(stateRef.current.ok).toBe(true);
    expect(stateRef.current.loading).toBe(false);
    cleanup();
  });

  it('embedder populated after poll', async () => {
    const { stateRef, cleanup } = mountRagHealth(true);
    await flush();
    expect(stateRef.current.embedder).toBe('bge-m3');
    cleanup();
  });

  it('ok=false when server returns ok:false', async () => {
    checkRagHealth.mockResolvedValue({ ok: false, error: 'pgvector down' });
    const { stateRef, cleanup } = mountRagHealth(true);
    await flush();
    expect(stateRef.current.ok).toBe(false);
    expect(stateRef.current.error).toBe('pgvector down');
    cleanup();
  });

  it('disabled=true → never polls', async () => {
    const { cleanup } = mountRagHealth(false);
    await flush(30000);
    expect(checkRagHealth).not.toHaveBeenCalled();
    cleanup();
  });
});

describe('useRagHealth — polling lifecycle', () => {
  it('polls again after 15s interval', async () => {
    const { cleanup } = mountRagHealth(true);
    await flush();
    const count1 = checkRagHealth.mock.calls.length;
    await flush(15000);
    expect(checkRagHealth.mock.calls.length).toBeGreaterThan(count1);
    cleanup();
  });

  it('recovers from error on next successful poll', async () => {
    checkRagHealth
      .mockResolvedValueOnce({ ok: false, error: 'unreachable' })
      .mockResolvedValue({ ok: true, enabled: true, embedder: 'bge-m3' });
    const { stateRef, cleanup } = mountRagHealth(true);
    await flush();
    expect(stateRef.current.ok).toBe(false);
    await flush(15000);
    expect(stateRef.current.ok).toBe(true);
    expect(stateRef.current.error).toBeNull();
    cleanup();
  });

  it('enabled toggle off stops polling', async () => {
    const { rerender, cleanup } = mountRagHealth(true);
    await flush();
    const countBefore = checkRagHealth.mock.calls.length;
    rerender(false);
    await flush(30000);
    // No new calls after disabling
    expect(checkRagHealth.mock.calls.length).toBe(countBefore);
    cleanup();
  });
});

// ---------------------------------------------------------------------------
// Stress: 100 random rag prop variations
// ---------------------------------------------------------------------------

describe('RagSources stress — 100 random rag prop shapes', () => {
  it('never throws and always returns consistent state', () => {
    const failures = [];
    for (let i = 0; i < 100; i++) {
      const rag = Math.random() < 0.1 ? null : {
        requested: Math.random() < 0.8,
        used: Math.random() < 0.6,
        hits: Math.random() < 0.3 ? null : Array.from(
          { length: Math.floor(Math.random() * 10) },
          (_, j) => ({
            source_path: `/docs/file${j}.txt`,
            chunk_idx: j,
            distance: Math.random(),
            content: Math.random() < 0.7 ? `chunk content ${j}` : '',
          })
        ),
        top_k: Math.floor(Math.random() * 10),
        min_score: Math.random(),
        reason: Math.random() < 0.3 ? 'below threshold' : undefined,
      };

      let state;
      try {
        state = ragRenderState(rag);
      } catch (e) {
        failures.push(`run ${i}: threw ${e.message}`);
        continue;
      }

      if (typeof state.render !== 'boolean') {
        failures.push(`run ${i}: render not boolean`);
      }
      if (state.render) {
        if (!Array.isArray(state.hits)) {
          failures.push(`run ${i}: hits not array`);
        }
        if (typeof state.used !== 'boolean') {
          failures.push(`run ${i}: used not boolean`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('formatDistance on 100 random values never throws', () => {
    const inputs = [
      ...Array.from({ length: 80 }, () => Math.random()),
      null, undefined, NaN, Infinity, -Infinity, 'x', 0, 1, -1,
    ];
    for (const v of inputs) {
      expect(() => formatDistance(v)).not.toThrow();
    }
  });
});
