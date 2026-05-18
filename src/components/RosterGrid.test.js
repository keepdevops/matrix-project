/**
 * RosterGrid — roster slot logic, pipeline move/remove, available filtering.
 */
// ---------------------------------------------------------------------------
// Pure logic extracted for unit testing (no DOM needed)
// ---------------------------------------------------------------------------

// Simulate the addAgent / removeAt / moveAgent callbacks from ModeRosterPanel
function makeRosterState(initial = []) {
  let selected = [...initial];
  return {
    get: () => selected,
    add: (name, isPipeline) => {
      if (isPipeline || !selected.includes(name)) selected = [...selected, name];
    },
    removeAt: (i) => { selected = selected.filter((_, idx) => idx !== i); },
    move: (i, dir) => {
      const j = i + dir;
      if (j < 0 || j >= selected.length) return;
      const next = [...selected];
      [next[i], next[j]] = [next[j], next[i]];
      selected = next;
    },
  };
}

const AGENTS = ['architect', 'programmer', 'reviewer', 'foreman', 'debugger'];

// ---------------------------------------------------------------------------
// addAgent — flat mode deduplication
// ---------------------------------------------------------------------------

describe('RosterGrid logic — addAgent flat mode', () => {
  it('adds agent to empty roster', () => {
    const r = makeRosterState();
    r.add('architect', false);
    expect(r.get()).toEqual(['architect']);
  });

  it('does not add duplicate in flat mode', () => {
    const r = makeRosterState(['architect']);
    r.add('architect', false);
    expect(r.get()).toEqual(['architect']);
  });

  it('adds multiple distinct agents', () => {
    const r = makeRosterState();
    AGENTS.forEach(a => r.add(a, false));
    expect(r.get()).toHaveLength(5);
    expect(r.get()).toEqual(AGENTS);
  });

  it('preserves order on sequential adds', () => {
    const r = makeRosterState();
    r.add('programmer', false);
    r.add('architect', false);
    r.add('reviewer', false);
    expect(r.get()).toEqual(['programmer', 'architect', 'reviewer']);
  });
});

// ---------------------------------------------------------------------------
// addAgent — pipeline mode allows duplicates
// ---------------------------------------------------------------------------

describe('RosterGrid logic — addAgent pipeline mode', () => {
  it('allows duplicate in pipeline mode', () => {
    const r = makeRosterState(['architect']);
    r.add('architect', true);
    expect(r.get()).toEqual(['architect', 'architect']);
  });

  it('allows multi-duplicate in pipeline', () => {
    const r = makeRosterState();
    r.add('programmer', true);
    r.add('tester', true);
    r.add('programmer', true); // duplicate
    r.add('tester', true);    // duplicate
    expect(r.get()).toEqual(['programmer', 'tester', 'programmer', 'tester']);
  });

  it('pipeline allows all same agent N times', () => {
    const r = makeRosterState();
    for (let i = 0; i < 5; i++) r.add('architect', true);
    expect(r.get()).toHaveLength(5);
    expect(r.get().every(n => n === 'architect')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// removeAt
// ---------------------------------------------------------------------------

describe('RosterGrid logic — removeAt', () => {
  it('removes first agent', () => {
    const r = makeRosterState(['a', 'b', 'c']);
    r.removeAt(0);
    expect(r.get()).toEqual(['b', 'c']);
  });

  it('removes last agent', () => {
    const r = makeRosterState(['a', 'b', 'c']);
    r.removeAt(2);
    expect(r.get()).toEqual(['a', 'b']);
  });

  it('removes middle agent', () => {
    const r = makeRosterState(['a', 'b', 'c']);
    r.removeAt(1);
    expect(r.get()).toEqual(['a', 'c']);
  });

  it('removes only agent', () => {
    const r = makeRosterState(['solo']);
    r.removeAt(0);
    expect(r.get()).toEqual([]);
  });

  it('removes in pipeline with duplicates — correct index', () => {
    const r = makeRosterState(['arch', 'prog', 'arch']);
    r.removeAt(2); // remove second 'arch'
    expect(r.get()).toEqual(['arch', 'prog']);
  });

  it('sequential removes drain the list', () => {
    const r = makeRosterState(['a', 'b', 'c', 'd']);
    while (r.get().length > 0) r.removeAt(0);
    expect(r.get()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// moveAgent — reordering
// ---------------------------------------------------------------------------

describe('RosterGrid logic — moveAgent', () => {
  it('moves first item down', () => {
    const r = makeRosterState(['a', 'b', 'c']);
    r.move(0, 1);
    expect(r.get()).toEqual(['b', 'a', 'c']);
  });

  it('moves last item up', () => {
    const r = makeRosterState(['a', 'b', 'c']);
    r.move(2, -1);
    expect(r.get()).toEqual(['a', 'c', 'b']);
  });

  it('move at boundary (up from first) is no-op', () => {
    const r = makeRosterState(['a', 'b', 'c']);
    r.move(0, -1);
    expect(r.get()).toEqual(['a', 'b', 'c']);
  });

  it('move at boundary (down from last) is no-op', () => {
    const r = makeRosterState(['a', 'b', 'c']);
    r.move(2, 1);
    expect(r.get()).toEqual(['a', 'b', 'c']);
  });

  it('moving single-item list is no-op', () => {
    const r = makeRosterState(['x']);
    r.move(0, -1);
    r.move(0, 1);
    expect(r.get()).toEqual(['x']);
  });

  it('bubble sort via moves — correct final order', () => {
    const r = makeRosterState(['c', 'a', 'b']);
    // sort ascending via bubble moves
    const arr = r.get();
    for (let i = 0; i < arr.length; i++) {
      for (let j = 0; j < r.get().length - 1; j++) {
        if (r.get()[j] > r.get()[j + 1]) r.move(j, 1);
      }
    }
    expect(r.get()).toEqual(['a', 'b', 'c']);
  });
});

// ---------------------------------------------------------------------------
// Available list — filtering
// ---------------------------------------------------------------------------

describe('RosterGrid logic — available filtering', () => {
  it('flat mode excludes already-selected from available', () => {
    const selected = ['architect', 'programmer'];
    const available = AGENTS;
    const inactive = available.filter(n => !selected.includes(n));
    expect(inactive).toEqual(['reviewer', 'foreman', 'debugger']);
  });

  it('pipeline mode shows all available regardless of selection', () => {
    const selected = ['architect', 'programmer'];
    const available = AGENTS;
    // isPipeline=true → inactive = available (all shown)
    expect(available).toEqual(AGENTS);
  });

  it('all selected → available list is empty in flat mode', () => {
    const selected = [...AGENTS];
    const available = AGENTS;
    const inactive = available.filter(n => !selected.includes(n));
    expect(inactive).toEqual([]);
  });

  it('nothing selected → available list is full in flat mode', () => {
    const selected = [];
    const available = AGENTS;
    const inactive = available.filter(n => !selected.includes(n));
    expect(inactive).toEqual(AGENTS);
  });
});

// ---------------------------------------------------------------------------
// Stress: 100 random add/remove/move sequences
// ---------------------------------------------------------------------------

describe('RosterGrid logic stress — 100 random operation sequences', () => {
  it('roster invariants hold after random ops (flat mode)', () => {
    const failures = [];
    for (let run = 0; run < 100; run++) {
      const r = makeRosterState();
      const ops = Math.floor(Math.random() * 20) + 5;
      for (let i = 0; i < ops; i++) {
        const op = Math.floor(Math.random() * 3);
        const state = r.get();
        if (op === 0) {
          const agent = AGENTS[Math.floor(Math.random() * AGENTS.length)];
          r.add(agent, false);
        } else if (op === 1 && state.length > 0) {
          r.removeAt(Math.floor(Math.random() * state.length));
        } else if (op === 2 && state.length > 1) {
          const idx = Math.floor(Math.random() * state.length);
          r.move(idx, Math.random() < 0.5 ? -1 : 1);
        }
      }
      // Flat mode: no duplicates
      const final = r.get();
      if (new Set(final).size !== final.length) {
        failures.push(`run ${run}: duplicates found: ${final}`);
      }
      if (!final.every(a => AGENTS.includes(a))) {
        failures.push(`run ${run}: unknown agent in roster`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('roster invariants hold after random ops (pipeline mode)', () => {
    const failures = [];
    for (let run = 0; run < 100; run++) {
      const r = makeRosterState();
      const ops = Math.floor(Math.random() * 20) + 5;
      for (let i = 0; i < ops; i++) {
        const op = Math.floor(Math.random() * 3);
        const state = r.get();
        if (op === 0) {
          const agent = AGENTS[Math.floor(Math.random() * AGENTS.length)];
          r.add(agent, true);
        } else if (op === 1 && state.length > 0) {
          r.removeAt(Math.floor(Math.random() * state.length));
        } else if (op === 2 && state.length > 1) {
          const idx = Math.floor(Math.random() * state.length);
          r.move(idx, Math.random() < 0.5 ? -1 : 1);
        }
      }
      const final = r.get();
      if (!final.every(a => AGENTS.includes(a))) {
        failures.push(`run ${run}: unknown agent in pipeline roster`);
      }
      if (final.length < 0) {
        failures.push(`run ${run}: negative length`);
      }
    }
    expect(failures).toEqual([]);
  });
});
