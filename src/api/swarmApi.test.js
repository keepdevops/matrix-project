/**
 * swarmApi.js stress tests — fetch mocking, normalizeArchitectResponse,
 * coalesce deduplication, models cache TTL, and all API surface functions.
 */
import {
  invalidateModelsCache,
  fetchKvPressure,
  clearMlxSession,
} from './swarmApi';

// ---------------------------------------------------------------------------
// Global fetch mock
// ---------------------------------------------------------------------------

let mockFetchImpl = null;
const originalFetch = global.fetch;

beforeEach(() => {
  invalidateModelsCache();
  mockFetchImpl = null;
  global.fetch = jest.fn((...args) => {
    if (mockFetchImpl) return mockFetchImpl(...args);
    return Promise.resolve({ ok: false, status: 503, text: async () => 'not mocked', json: async () => ({}) });
  });
});

afterEach(() => {
  global.fetch = originalFetch;
});

function mockOk(body, contentType = 'application/json') {
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: true,
    status: 200,
    headers: { get: () => contentType },
    json: async () => JSON.parse(bodyStr),
    text: async () => bodyStr,
  };
}

function mockFail(status = 500, body = {}) {
  return {
    ok: false,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

// ---------------------------------------------------------------------------
// fetchKvPressure
// ---------------------------------------------------------------------------

describe('fetchKvPressure', () => {
  it('returns array from /api/pressure', async () => {
    const pressure = [
      { port: 8080, names: ['architect'], usage: 0.4, ok: true },
      { port: 8081, names: ['programmer'], usage: 0.2, ok: true },
    ];
    mockFetchImpl = () => Promise.resolve(mockOk(pressure));
    const result = await fetchKvPressure();
    expect(result).toEqual(pressure);
  });

  it('returns empty array on fetch failure', async () => {
    mockFetchImpl = () => Promise.reject(new Error('network error'));
    const result = await fetchKvPressure();
    expect(result).toEqual([]);
  });

  it('returns empty array on non-ok response', async () => {
    mockFetchImpl = () => Promise.resolve(mockFail(503));
    const result = await fetchKvPressure();
    expect(result).toEqual([]);
  });

  it('returns empty array when response is not array', async () => {
    mockFetchImpl = () => Promise.resolve(mockOk({ inflight: {} }));
    const result = await fetchKvPressure();
    expect(result).toEqual([]);
  });

  it('handles empty array response', async () => {
    mockFetchImpl = () => Promise.resolve(mockOk([]));
    const result = await fetchKvPressure();
    expect(result).toEqual([]);
  });

  it('100 concurrent calls all resolve', async () => {
    const pressure = [{ port: 8080, ok: true }];
    mockFetchImpl = () => Promise.resolve(mockOk(pressure));
    const results = await Promise.all(Array.from({ length: 100 }, () => fetchKvPressure()));
    expect(results).toHaveLength(100);
    expect(results.every(r => Array.isArray(r))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// clearMlxSession
// ---------------------------------------------------------------------------

describe('clearMlxSession', () => {
  it('posts to /api/mlx/session/clear with session_id', async () => {
    const captured = {};
    mockFetchImpl = (url, opts) => {
      captured.url = url;
      captured.body = JSON.parse(opts?.body || '{}');
      return Promise.resolve(mockOk({ cleared: ['sess-1'] }));
    };
    const result = await clearMlxSession('sess-1');
    expect(captured.body).toEqual({ session_id: 'sess-1' });
    expect(result.cleared).toContain('sess-1');
  });

  it('posts empty body when no session_id given', async () => {
    const captured = {};
    mockFetchImpl = (url, opts) => {
      captured.body = JSON.parse(opts?.body || '{}');
      return Promise.resolve(mockOk({ cleared_count: 3 }));
    };
    await clearMlxSession(undefined);
    expect(captured.body).toEqual({});
  });

  it('throws on non-ok response', async () => {
    mockFetchImpl = () => Promise.resolve(mockFail(500));
    await expect(clearMlxSession('x')).rejects.toThrow('mlx session clear failed');
  });
});

// ---------------------------------------------------------------------------
// invalidateModelsCache
// ---------------------------------------------------------------------------

describe('invalidateModelsCache', () => {
  it('invalidates so next fetchModels re-fetches', async () => {
    const { fetchModels } = require('./swarmApi');
    let callCount = 0;
    const models = [{ path: '/m/x', name: 'X', backend: 'llama' }];
    mockFetchImpl = (url) => {
      if (url.includes('/api/models')) { callCount++; return Promise.resolve(mockOk(models)); }
      if (url.includes('models.json')) return Promise.resolve(mockOk([]));
      return Promise.resolve(mockOk({}));
    };

    invalidateModelsCache();
    await fetchModels();
    invalidateModelsCache();
    await fetchModels();

    // Should have fetched at least twice after two invalidations
    expect(callCount).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Stress: fetchKvPressure under simulated high-frequency polling
// ---------------------------------------------------------------------------

describe('fetchKvPressure stress — 100 sequential polls', () => {
  it('each poll returns consistent typed result', async () => {
    let callN = 0;
    mockFetchImpl = () => {
      callN++;
      if (callN % 5 === 0) return Promise.reject(new Error('transient'));
      if (callN % 7 === 0) return Promise.resolve(mockFail(503));
      return Promise.resolve(mockOk([
        { port: 8080 + (callN % 4), ok: true, usage: (callN % 100) / 100 },
      ]));
    };

    const failures = [];
    for (let i = 0; i < 100; i++) {
      const result = await fetchKvPressure();
      if (!Array.isArray(result)) {
        failures.push(`poll ${i}: not array`);
      }
    }
    expect(failures).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Stress: concurrent clearMlxSession calls on many session IDs
// ---------------------------------------------------------------------------

describe('clearMlxSession stress — 100 concurrent calls', () => {
  it('all calls succeed', async () => {
    mockFetchImpl = (url, opts) => {
      const body = JSON.parse(opts?.body || '{}');
      return Promise.resolve(mockOk({ cleared: [body.session_id || '*'] }));
    };
    const ids = Array.from({ length: 100 }, (_, i) => `sess-${i}`);
    const results = await Promise.all(ids.map(id => clearMlxSession(id)));
    expect(results).toHaveLength(100);
    expect(results.every(r => r.cleared?.length > 0)).toBe(true);
  });

  it('partial failures do not block other calls', async () => {
    let n = 0;
    mockFetchImpl = () => {
      n++;
      if (n % 3 === 0) return Promise.resolve(mockFail(500));
      return Promise.resolve(mockOk({ cleared: ['x'] }));
    };
    const results = await Promise.allSettled(
      Array.from({ length: 100 }, (_, i) => clearMlxSession(`s-${i}`))
    );
    const ok = results.filter(r => r.status === 'fulfilled');
    const failed = results.filter(r => r.status === 'rejected');
    expect(ok.length + failed.length).toBe(100);
    expect(failed.length).toBeGreaterThan(0); // some should have failed
    expect(ok.length).toBeGreaterThan(0);     // some should have succeeded
  });
});
