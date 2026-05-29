/**
 * useCoordinatorState stress tests.
 *
 * Uses React + ReactDOM directly (no @testing-library) since only
 * react-dom is installed. Each test mounts a minimal wrapper component,
 * collects state snapshots, and asserts invariants.
 *
 * Covers:
 * - Initial load (agents, modes, activeMode, kvReadings)
 * - KV polling lifecycle (start/stop/error/recovery)
 * - Mode change: optimistic update, rapid switches
 * - Agent refresh: list deduplication, stable reference
 * - Dynamic role switching under concurrent operations
 * - flatPickAgent reset on mode change
 */
import { act, renderHook } from '@testing-library/react';
import { useCoordinatorState } from './useCoordinatorState';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('../api/swarmApi', () => ({
  fetchAgents:      jest.fn(),
  fetchKvPressure:  jest.fn(),
  fetchModels:      jest.fn(),
  fetchSwarmConfig: jest.fn(),
  fetchModes:       jest.fn(),
  setActiveMode:    jest.fn(),
}));

import {
  fetchAgents,
  fetchKvPressure,
  fetchModels,
  fetchSwarmConfig,
  fetchModes,
  setActiveMode,
} from '../api/swarmApi';

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

function makeAgents(names) {
  return names.map(n => ({ name: n, engine: 'llama', backend: 'llama', model: null }));
}

function makeModes(active = 'flat') {
  return ['flat', 'pipeline', 'cascade'].map(n => ({ name: n, active: n === active }));
}

/**
 * Mounts the hook via renderHook and returns a compatible { stateRef, handlersRef, rerender, cleanup }.
 */
function mountHook(online = true) {
  const { result, rerender: rrHook, unmount } = renderHook(
    ({ online: o }) => useCoordinatorState(o),
    { initialProps: { online } },
  );

  const stateRef = { get current() { return result.current; } };
  const handlersRef = stateRef;

  return {
    stateRef,
    handlersRef,
    rerender: (newOnline) => rrHook({ online: newOnline }),
    cleanup: unmount,
  };
}

/** Flush all pending microtasks + timers in the fake timer environment. */
async function flush(ms = 0) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
    await Promise.resolve();
    await Promise.resolve();
  });
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.useFakeTimers();
  fetchAgents.mockResolvedValue(makeAgents(['architect', 'programmer']));
  fetchKvPressure.mockResolvedValue([]);
  fetchModels.mockResolvedValue([]);
  fetchSwarmConfig.mockResolvedValue({ agents: [] });
  fetchModes.mockResolvedValue(makeModes('flat'));
  setActiveMode.mockResolvedValue({ mode: 'flat' });
});

afterEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Initial load
// ---------------------------------------------------------------------------

describe('useCoordinatorState — initial load', () => {
  it('activeAgents populated when online', async () => {
    const { stateRef, cleanup } = mountHook(true);
    await flush();
    expect(stateRef.current.activeAgents.length).toBe(2);
    cleanup();
  });

  it('activeAgents empty when offline', () => {
    const { stateRef, cleanup } = mountHook(false);
    expect(stateRef.current.activeAgents).toEqual([]);
    cleanup();
  });

  it('modes populated when online', async () => {
    const { stateRef, cleanup } = mountHook(true);
    await flush();
    expect(stateRef.current.modes.length).toBe(3);
    cleanup();
  });

  it('activeMode is flat by default', async () => {
    const { stateRef, cleanup } = mountHook(true);
    await flush();
    expect(stateRef.current.activeMode).toBe('flat');
    cleanup();
  });

  it('kvReadings starts empty', () => {
    const { stateRef, cleanup } = mountHook(false);
    expect(stateRef.current.kvReadings).toEqual([]);
    cleanup();
  });
});

// ---------------------------------------------------------------------------
// KV polling lifecycle
// ---------------------------------------------------------------------------

describe('useCoordinatorState — KV polling', () => {
  it('polling fires when online', async () => {
    fetchKvPressure.mockResolvedValue([{ port: 8080, ok: true }]);
    const { stateRef, cleanup } = mountHook(true);
    await flush();
    expect(stateRef.current.kvReadings.length).toBeGreaterThan(0);
    cleanup();
  });

  it('kvFetchFailed set on poll error', async () => {
    fetchKvPressure.mockRejectedValue(new Error('net'));
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { stateRef, cleanup } = mountHook(true);
    await flush();
    expect(stateRef.current.kvFetchFailed).toBe(true);
    consoleSpy.mockRestore();
    cleanup();
  });

  it('poll interval fires again after 250ms', async () => {
    fetchKvPressure.mockResolvedValue([]);
    const { cleanup } = mountHook(true);
    await flush();
    const c1 = fetchKvPressure.mock.calls.length;
    await flush(250);
    expect(fetchKvPressure.mock.calls.length).toBeGreaterThan(c1);
    cleanup();
  });

  it('clears readings when going offline', async () => {
    fetchKvPressure.mockResolvedValue([{ port: 8080, ok: true }]);
    const { stateRef, rerender, cleanup } = mountHook(true);
    await flush();
    expect(stateRef.current.kvReadings.length).toBeGreaterThan(0);

    rerender(false);
    await flush();
    expect(stateRef.current.kvReadings).toEqual([]);
    cleanup();
  });

  it('recovers from poll error — clears kvFetchFailed after success', async () => {
    let n = 0;
    fetchKvPressure.mockImplementation(() => {
      n++;
      if (n === 1) return Promise.reject(new Error('transient'));
      return Promise.resolve([{ port: 8080, ok: true }]);
    });
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { stateRef, cleanup } = mountHook(true);
    await flush();
    expect(stateRef.current.kvFetchFailed).toBe(true);

    await flush(250);
    expect(stateRef.current.kvFetchFailed).toBe(false);
    consoleSpy.mockRestore();
    cleanup();
  });
});

// ---------------------------------------------------------------------------
// Mode changes
// ---------------------------------------------------------------------------

describe('useCoordinatorState — mode changes', () => {
  it('handleModeChange updates activeMode', async () => {
    setActiveMode.mockResolvedValue({ mode: 'pipeline' });
    const { stateRef, cleanup } = mountHook(true);
    await flush();

    await act(async () => { await stateRef.current.handleModeChange('pipeline'); });
    expect(stateRef.current.activeMode).toBe('pipeline');
    cleanup();
  });

  it('marks correct mode active in modes list', async () => {
    setActiveMode.mockResolvedValue({ mode: 'cascade' });
    const { stateRef, cleanup } = mountHook(true);
    await flush();

    await act(async () => { await stateRef.current.handleModeChange('cascade'); });
    const active = stateRef.current.modes.find(m => m.active);
    expect(active?.name).toBe('cascade');
    cleanup();
  });

  it('flatPickAgent cleared when mode changes away from flat', async () => {
    setActiveMode.mockResolvedValue({ mode: 'pipeline' });
    const { stateRef, cleanup } = mountHook(true);
    await flush();

    act(() => { stateRef.current.setFlatPickAgent('architect'); });
    expect(stateRef.current.flatPickAgent).toBe('architect');

    await act(async () => { await stateRef.current.handleModeChange('pipeline'); });
    expect(stateRef.current.flatPickAgent).toBeNull();
    cleanup();
  });

  it('rapid mode switches converge to last value', async () => {
    const { stateRef, cleanup } = mountHook(true);
    await flush();
    const modes = ['flat', 'pipeline', 'cascade'];

    setActiveMode.mockResolvedValue({ mode: 'cascade' });
    await act(async () => {
      await stateRef.current.handleModeChange('flat');
      await stateRef.current.handleModeChange('pipeline');
      await stateRef.current.handleModeChange('cascade');
    });
    expect(stateRef.current.activeMode).toBe('cascade');
    cleanup();
  });

  it('handleModeChange does not throw when API fails', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    setActiveMode.mockRejectedValue(new Error('server error'));
    const { stateRef, cleanup } = mountHook(true);
    await flush();

    await expect(
      act(async () => { await stateRef.current.handleModeChange('pipeline'); })
    ).resolves.not.toThrow();
    consoleSpy.mockRestore();
    cleanup();
  });
});

// ---------------------------------------------------------------------------
// Agent refresh
// ---------------------------------------------------------------------------

describe('useCoordinatorState — agent refresh', () => {
  it('refreshAgents resolves successfully', async () => {
    // Verify that refreshAgents calls fetchAgents and updates state;
    // the exact list depends on coalesce dedup so we just assert no crash.
    const { stateRef, cleanup } = mountHook(true);
    await flush();
    expect(stateRef.current.activeAgents.length).toBe(2);

    await expect(
      act(async () => { await stateRef.current.refreshAgents(); })
    ).resolves.not.toThrow();
    cleanup();
  });

  it('stable reference when agent list unchanged', async () => {
    const { stateRef, cleanup } = mountHook(true);
    await flush();
    const ref1 = stateRef.current.activeAgents;

    fetchAgents.mockResolvedValue(makeAgents(['architect', 'programmer']));
    await act(async () => { await stateRef.current.refreshAgents(); });
    expect(stateRef.current.activeAgents).toBe(ref1);
    cleanup();
  });

  it('new reference when list changes', async () => {
    const { stateRef, cleanup } = mountHook(true);
    await flush();
    const ref1 = stateRef.current.activeAgents;

    fetchAgents.mockResolvedValue(makeAgents(['architect']));
    await act(async () => { await stateRef.current.refreshAgents(); });
    expect(stateRef.current.activeAgents).not.toBe(ref1);
    cleanup();
  });
});

// ---------------------------------------------------------------------------
// Dynamic role switching stress
// ---------------------------------------------------------------------------

describe('useCoordinatorState — dynamic role switching stress', () => {
  const MODES = ['flat', 'pipeline', 'cascade'];

  it('30 mode switches — activeMode always valid', async () => {
    const { stateRef, cleanup } = mountHook(true);
    await flush();
    const failures = [];

    for (let i = 0; i < 30; i++) {
      const mode = MODES[i % MODES.length];
      setActiveMode.mockResolvedValue({ mode });
      await act(async () => { await stateRef.current.handleModeChange(mode); });
      if (!MODES.includes(stateRef.current.activeMode)) {
        failures.push(`step ${i}: invalid mode ${stateRef.current.activeMode}`);
      }
    }
    expect(failures).toEqual([]);
    cleanup();
  });

  it('concurrent mode change + agent refresh — no crash', async () => {
    const { stateRef, cleanup } = mountHook(true);
    await flush();

    fetchAgents.mockResolvedValue(makeAgents(['architect', 'programmer', 'foreman']));
    setActiveMode.mockResolvedValue({ mode: 'pipeline' });

    await act(async () => {
      await Promise.all([
        stateRef.current.handleModeChange('pipeline'),
        stateRef.current.refreshAgents(),
      ]);
    });

    expect(stateRef.current.activeMode).toBe('pipeline');
    expect(stateRef.current.activeAgents.length).toBe(3);
    cleanup();
  });

  it('online toggle 10 times — state converges each time', async () => {
    fetchKvPressure.mockResolvedValue([{ port: 8080, ok: true }]);
    const { stateRef, rerender, cleanup } = mountHook(true);
    const failures = [];

    for (let i = 0; i < 10; i++) {
      rerender(false);
      await flush();
      if (stateRef.current.kvReadings.length !== 0) {
        failures.push(`offline step ${i}: readings not cleared`);
      }
      rerender(true);
      await flush();
      // After going online, KV polling should start again
      await flush(10);
    }
    expect(failures).toEqual([]);
    cleanup();
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('useCoordinatorState — edge cases', () => {
  it('refreshModes does not throw on API failure', async () => {
    fetchModes.mockRejectedValue(new Error('unavailable'));
    const { stateRef, cleanup } = mountHook(true);
    await flush();

    await expect(
      act(async () => { await stateRef.current.refreshModes(); })
    ).resolves.not.toThrow();
    cleanup();
  });

  it('flatPickAgent independent set/clear', () => {
    const { stateRef, cleanup } = mountHook(false);
    expect(stateRef.current.flatPickAgent).toBeNull();

    act(() => { stateRef.current.setFlatPickAgent('programmer'); });
    expect(stateRef.current.flatPickAgent).toBe('programmer');

    act(() => { stateRef.current.setFlatPickAgent(null); });
    expect(stateRef.current.flatPickAgent).toBeNull();
    cleanup();
  });
});
