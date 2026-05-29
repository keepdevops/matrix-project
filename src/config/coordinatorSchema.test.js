/**
 * coordinatorSchema tests.
 *
 * Covers:
 * - REGISTERED_MODE_NAMES: all four modes present
 * - MODE_CONFIG_SHAPE: each mode has expected keys
 * - PRESET_SHAPE: has required fields with correct types
 * - No unknown mode names in REGISTERED_MODE_NAMES
 * - MODE_CONFIG_SHAPE covers exactly REGISTERED_MODE_NAMES
 * - Stress: 50 random mode lookups return defined shapes
 */
import {
  REGISTERED_MODE_NAMES,
  MODE_CONFIG_SHAPE,
  PRESET_SHAPE,
} from './coordinatorSchema';

const EXPECTED_MODES = ['flat', 'pipeline', 'cascade', 'router'];

// ---------------------------------------------------------------------------
// REGISTERED_MODE_NAMES
// ---------------------------------------------------------------------------

test('REGISTERED_MODE_NAMES is an array', () => {
  expect(Array.isArray(REGISTERED_MODE_NAMES)).toBe(true);
});

test('REGISTERED_MODE_NAMES contains all four modes', () => {
  EXPECTED_MODES.forEach(m => {
    expect(REGISTERED_MODE_NAMES).toContain(m);
  });
});

test('REGISTERED_MODE_NAMES contains no unknown values', () => {
  REGISTERED_MODE_NAMES.forEach(m => {
    expect(EXPECTED_MODES).toContain(m);
  });
});

// ---------------------------------------------------------------------------
// MODE_CONFIG_SHAPE
// ---------------------------------------------------------------------------

test('MODE_CONFIG_SHAPE has an entry for every registered mode', () => {
  REGISTERED_MODE_NAMES.forEach(m => {
    expect(MODE_CONFIG_SHAPE[m]).toBeDefined();
    expect(typeof MODE_CONFIG_SHAPE[m]).toBe('object');
  });
});

test('MODE_CONFIG_SHAPE has no entries for unregistered modes', () => {
  Object.keys(MODE_CONFIG_SHAPE).forEach(m => {
    expect(REGISTERED_MODE_NAMES).toContain(m);
  });
});

test('pipeline shape has agents, order, synthesizer', () => {
  const s = MODE_CONFIG_SHAPE.pipeline;
  expect(s.agents).toBeDefined();
  expect(s.order).toBeDefined();
  expect(s.synthesizer).toBeDefined();
});

test('cascade shape has agents and synthesizer', () => {
  const s = MODE_CONFIG_SHAPE.cascade;
  expect(s.agents).toBeDefined();
  expect(s.synthesizer).toBeDefined();
});

test('router shape has agents and max_select', () => {
  const s = MODE_CONFIG_SHAPE.router;
  expect(s.agents).toBeDefined();
  expect(s.max_select).toBeDefined();
});

test('flat shape has agents key', () => {
  expect(MODE_CONFIG_SHAPE.flat.agents).toBeDefined();
});

// ---------------------------------------------------------------------------
// PRESET_SHAPE
// ---------------------------------------------------------------------------

test('PRESET_SHAPE has mode, agents, synthesizer, max_select', () => {
  expect(PRESET_SHAPE.mode).toBeDefined();
  expect(PRESET_SHAPE.agents).toBeDefined();
  expect(PRESET_SHAPE.synthesizer).toBeDefined();
  expect(PRESET_SHAPE.max_select).toBeDefined();
});

test('PRESET_SHAPE mode is string type hint', () => {
  expect(PRESET_SHAPE.mode).toBe('string');
});

test('PRESET_SHAPE max_select is number type hint', () => {
  expect(PRESET_SHAPE.max_select).toBe('number');
});

// ---------------------------------------------------------------------------
// MODE_CONFIG_SHAPE — exhaustive key validation
// ---------------------------------------------------------------------------

const EXPECTED_SHAPE_KEYS = {
  flat:     ['agents', 'variant_policy'],
  pipeline: ['agents', 'order', 'preset', 'synthesizer', 'stage_context_chars'],
  cascade:  ['agents', 'synthesizer', 'synthesis_policy'],
  router:   ['agents', 'max_select', 'classifier_policy'],
};

test.each(Object.entries(EXPECTED_SHAPE_KEYS))(
  'MODE_CONFIG_SHAPE[%s] has exactly the expected keys',
  (mode, expectedKeys) => {
    const shape = MODE_CONFIG_SHAPE[mode];
    expect(Object.keys(shape).sort()).toEqual(expectedKeys.slice().sort());
  }
);

test('all MODE_CONFIG_SHAPE values are plain non-null objects', () => {
  Object.entries(MODE_CONFIG_SHAPE).forEach(([mode, shape]) => {
    expect(shape).not.toBeNull();
    expect(Array.isArray(shape)).toBe(false);
    expect(typeof shape).toBe('object');
  });
});

// ---------------------------------------------------------------------------
// PRESET_SHAPE — completeness and type hints
// ---------------------------------------------------------------------------

test('PRESET_SHAPE has exactly the four expected keys', () => {
  expect(Object.keys(PRESET_SHAPE).sort()).toEqual(['agents', 'max_select', 'mode', 'synthesizer']);
});

test('PRESET_SHAPE agents type hint is string[]', () => {
  expect(PRESET_SHAPE.agents).toBe('string[]');
});

test('PRESET_SHAPE synthesizer type hint is string', () => {
  expect(PRESET_SHAPE.synthesizer).toBe('string');
});

test('PRESET_SHAPE is a plain non-null object', () => {
  expect(PRESET_SHAPE).not.toBeNull();
  expect(Array.isArray(PRESET_SHAPE)).toBe(false);
});

// ---------------------------------------------------------------------------
// Stress: 50 random mode lookups
// ---------------------------------------------------------------------------

test('stress: 50 random mode lookups return defined shapes', () => {
  for (let i = 0; i < 50; i++) {
    const mode = REGISTERED_MODE_NAMES[i % REGISTERED_MODE_NAMES.length];
    const shape = MODE_CONFIG_SHAPE[mode];
    expect(shape).toBeDefined();
    expect(typeof shape).toBe('object');
    expect(shape.agents).toBeDefined();
  }
});
