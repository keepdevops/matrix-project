/**
 * BL1-6 — Layout editor: reducer, persistence, registry integration,
 * GridTemplates structure, EditorShell save wiring.
 */
import { reducer, initialState, DEFAULT_FLOW_NODES } from './editorReducer';
import {
  loadCustomLayouts, saveCustomLayout, deleteCustomLayout,
  getCustomLayout, makeId,
} from './persistence/customLayouts';
import { GRID_TEMPLATES } from './grid/GridTemplates';
import { PANEL_NAMES } from './renderers/PanelRegistry';

const fs   = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

const shellSrc    = read('editor/EditorShell.js');
const registrySrc = read('layouts/registry.js');
const wrapperSrc  = read('layouts/CustomLayoutWrapper.js');
const customHookSrc = read('editor/persistence/useCustomLayouts.js');

beforeEach(() => localStorage.clear());

// ── editorReducer ────────────────────────────────────────────────────────────

describe('editorReducer', () => {
  it('SET_MODE updates mode', () => {
    const s = reducer(initialState, { type: 'SET_MODE', mode: 'freeform' });
    expect(s.mode).toBe('freeform');
  });

  it('SET_NAME updates layoutName', () => {
    const s = reducer(initialState, { type: 'SET_NAME', name: 'My Custom' });
    expect(s.layoutName).toBe('My Custom');
  });

  it('SET_TEMPLATE populates slots from template areas', () => {
    const s = reducer(initialState, { type: 'SET_TEMPLATE', key: 'minimal' });
    expect(s.activeTemplate).toBe('minimal');
    expect(Object.keys(s.slots)).toEqual(expect.arrayContaining(['main', 'prompt']));
  });

  it('SET_TEMPLATE ignores "." area fillers', () => {
    const s = reducer(initialState, { type: 'SET_TEMPLATE', key: 'sidebar' });
    expect(Object.keys(s.slots)).not.toContain('.');
  });

  it('SET_SLOT assigns a panel to a slot', () => {
    const s = reducer(initialState, { type: 'SET_SLOT', slot: 'main', panel: 'ConversationThread' });
    expect(s.slots.main).toBe('ConversationThread');
  });

  it('CLEAR_SLOT nulls a slot', () => {
    let s = reducer(initialState, { type: 'SET_SLOT', slot: 'main', panel: 'MetricsStrip' });
    s = reducer(s, { type: 'CLEAR_SLOT', slot: 'main' });
    expect(s.slots.main).toBeNull();
  });

  it('ADD_FREE_PANEL appends a positioned panel with id', () => {
    const s = reducer({ ...initialState, freePanels: [] }, { type: 'ADD_FREE_PANEL', panel: 'MetricsStrip' });
    expect(s.freePanels).toHaveLength(1);
    expect(s.freePanels[0].panel).toBe('MetricsStrip');
    expect(s.freePanels[0].id).toBeDefined();
    expect(s.freePanels[0].w).toBeGreaterThan(0);
    expect(s.freePanels[0].h).toBeGreaterThan(0);
  });

  it('ADD_FREE_PANEL is a no-op when panel already exists', () => {
    let s = reducer({ ...initialState, freePanels: [] }, { type: 'ADD_FREE_PANEL', panel: 'AgentGrid' });
    s = reducer(s, { type: 'ADD_FREE_PANEL', panel: 'AgentGrid' });
    expect(s.freePanels).toHaveLength(1);
  });

  it('MOVE_FREE_PANEL updates x/y for matching id only', () => {
    let s = reducer({ ...initialState, freePanels: [] }, { type: 'ADD_FREE_PANEL', panel: 'MetricsStrip' });
    const id = s.freePanels[0].id;
    s = reducer(s, { type: 'MOVE_FREE_PANEL', id, x: 200, y: 150 });
    expect(s.freePanels[0].x).toBe(200);
    expect(s.freePanels[0].y).toBe(150);
  });

  it('RESIZE_FREE_PANEL clamps to minimum 120×80', () => {
    let s = reducer({ ...initialState, freePanels: [] }, { type: 'ADD_FREE_PANEL', panel: 'RagSources' });
    const id = s.freePanels[0].id;
    s = reducer(s, { type: 'RESIZE_FREE_PANEL', id, w: 10, h: 10 });
    expect(s.freePanels[0].w).toBe(120);
    expect(s.freePanels[0].h).toBe(80);
  });

  it('BRING_FORWARD increments z-index', () => {
    let s = reducer({ ...initialState, freePanels: [] }, { type: 'ADD_FREE_PANEL', panel: 'PromptInput' });
    const id = s.freePanels[0].id;
    const zBefore = s.freePanels[0].z;
    s = reducer(s, { type: 'BRING_FORWARD', id });
    expect(s.freePanels[0].z).toBe(zBefore + 1);
  });

  it('SEND_BACK decrements z-index but never below 1', () => {
    let s = reducer({ ...initialState, freePanels: [] }, { type: 'ADD_FREE_PANEL', panel: 'PromptInput' });
    const id = s.freePanels[0].id;
    s = reducer(s, { type: 'SEND_BACK', id });
    s = reducer(s, { type: 'SEND_BACK', id });
    expect(s.freePanels[0].z).toBeGreaterThanOrEqual(1);
  });

  it('REMOVE_FREE_PANEL removes only the matching panel', () => {
    let s = reducer({ ...initialState, freePanels: [] }, { type: 'ADD_FREE_PANEL', panel: 'AgentGrid' });
    s = reducer(s, { type: 'ADD_FREE_PANEL', panel: 'MetricsStrip' });
    const id = s.freePanels[0].id;
    s = reducer(s, { type: 'REMOVE_FREE_PANEL', id });
    expect(s.freePanels).toHaveLength(1);
    expect(s.freePanels[0].panel).toBe('MetricsStrip');
  });

  it('SET_FLOW_NODES replaces flow nodes', () => {
    const nodes = [{ id: 'a', type: 'agentNode', position: { x: 0, y: 0 }, data: { role: 'architect' } }];
    const s = reducer(initialState, { type: 'SET_FLOW_NODES', nodes });
    expect(s.flowNodes).toEqual(nodes);
  });

  it('SET_FLOW_EDGES replaces flow edges', () => {
    const edges = [{ id: 'e1', source: 'a', target: 'b' }];
    const s = reducer(initialState, { type: 'SET_FLOW_EDGES', edges });
    expect(s.flowEdges).toEqual(edges);
  });

  it('unknown action returns state unchanged', () => {
    const s = reducer(initialState, { type: 'NOOP_UNKNOWN' });
    expect(s).toBe(initialState);
  });

  it('initialState has 4 default flow nodes', () => {
    expect(DEFAULT_FLOW_NODES).toHaveLength(4);
    expect(DEFAULT_FLOW_NODES.map(n => n.id)).toEqual(
      expect.arrayContaining(['architect', 'programmer', 'reviewer', 'foreman']),
    );
  });
});

// ── customLayouts CRUD ───────────────────────────────────────────────────────

describe('customLayouts — CRUD', () => {
  it('loadCustomLayouts returns [] when empty', () => {
    expect(loadCustomLayouts()).toEqual([]);
  });

  it('saveCustomLayout adds entry with updatedAt', () => {
    const before = Date.now();
    saveCustomLayout({ id: 'c1', type: 'grid', label: 'Test Grid' });
    const [saved] = loadCustomLayouts();
    expect(saved.id).toBe('c1');
    expect(saved.updatedAt).toBeGreaterThanOrEqual(before);
  });

  it('saveCustomLayout upserts by id', () => {
    saveCustomLayout({ id: 'c1', label: 'First' });
    saveCustomLayout({ id: 'c1', label: 'Second' });
    const all = loadCustomLayouts();
    expect(all).toHaveLength(1);
    expect(all[0].label).toBe('Second');
  });

  it('getCustomLayout returns the entry by id', () => {
    saveCustomLayout({ id: 'c2', type: 'freeform', label: 'Canvas' });
    expect(getCustomLayout('c2')).toMatchObject({ id: 'c2', type: 'freeform' });
  });

  it('getCustomLayout returns null for unknown id', () => {
    expect(getCustomLayout('nonexistent')).toBeNull();
  });

  it('deleteCustomLayout removes by id', () => {
    saveCustomLayout({ id: 'c3', label: 'A' });
    saveCustomLayout({ id: 'c4', label: 'B' });
    deleteCustomLayout('c3');
    expect(loadCustomLayouts().map(l => l.id)).toEqual(['c4']);
  });

  it('makeId generates unique prefixed ids', () => {
    const a = makeId();
    const b = makeId();
    expect(a).toMatch(/^custom-/);
    expect(a).not.toBe(b);
  });
});

// ── GridTemplates structure ───────────────────────────────────────────────────

describe('GridTemplates — structure', () => {
  const TEMPLATE_KEYS = Object.keys(GRID_TEMPLATES);

  it('has at least 4 templates', () => {
    expect(TEMPLATE_KEYS.length).toBeGreaterThanOrEqual(4);
  });

  it.each(TEMPLATE_KEYS)('%s has areas, rows, cols and a label', (key) => {
    const tpl = GRID_TEMPLATES[key];
    expect(Array.isArray(tpl.areas)).toBe(true);
    expect(tpl.areas.length).toBeGreaterThan(0);
    expect(Array.isArray(tpl.rows)).toBe(true);
    expect(Array.isArray(tpl.cols)).toBe(true);
    expect(typeof tpl.label).toBe('string');
  });

  it.each(TEMPLATE_KEYS)('%s rows count matches areas row count', (key) => {
    const { areas, rows } = GRID_TEMPLATES[key];
    expect(rows).toHaveLength(areas.length);
  });

  it.each(TEMPLATE_KEYS)('%s cols count matches areas column count', (key) => {
    const { areas, cols } = GRID_TEMPLATES[key];
    expect(cols).toHaveLength(areas[0].length);
  });

  it('all template area cells are non-empty strings (named slots or dot fillers)', () => {
    for (const tpl of Object.values(GRID_TEMPLATES)) {
      for (const row of tpl.areas) {
        for (const cell of row) {
          expect(typeof cell).toBe('string');
          expect(cell.length).toBeGreaterThan(0);
        }
      }
    }
  });
});

// ── registry.js — registerCustomLayout ───────────────────────────────────────

describe('registerCustomLayout — registry integration', () => {
  it('is exported from registry.js', () => {
    expect(registrySrc).toMatch(/export function registerCustomLayout/);
  });

  it('mutates LAYOUTS to add the new entry', () => {
    expect(registrySrc).toMatch(/LAYOUTS\[id\] = \{ label, component \}/);
  });

  it('CustomLayoutWrapper is exported from layouts/CustomLayoutWrapper.js', () => {
    expect(wrapperSrc).toMatch(/export default function CustomLayoutWrapper/);
  });

  it('CustomLayoutWrapper delegates to GridLayoutRenderer for type=grid', () => {
    expect(wrapperSrc).toMatch(/GridLayoutRenderer/);
    expect(wrapperSrc).toMatch(/def\.type === 'grid'/);
  });

  it('CustomLayoutWrapper delegates to FreeformLayoutRenderer for type=freeform', () => {
    expect(wrapperSrc).toMatch(/FreeformLayoutRenderer/);
    expect(wrapperSrc).toMatch(/def\.type === 'freeform'/);
  });

  it('CustomLayoutWrapper shows error when layout id not found', () => {
    expect(wrapperSrc).toMatch(/not found/);
    expect(wrapperSrc).toMatch(/getCustomLayout\(layoutId\)/);
  });
});

// ── EditorShell — save wiring & tabs ─────────────────────────────────────────

describe('EditorShell — save wiring and tabs', () => {
  it('exposes Grid, Canvas and Flow tabs', () => {
    expect(shellSrc).toMatch(/'grid'/);
    expect(shellSrc).toMatch(/'freeform'/);
    expect(shellSrc).toMatch(/'flow'/);
  });

  it('flow save calls saveFlowConfig with derived mode', () => {
    expect(shellSrc).toMatch(/deriveMode\(state\.flowNodes, state\.flowEdges\)/);
    expect(shellSrc).toMatch(/saveFlowConfig\(/);
    expect(shellSrc).toMatch(/derived mode: \$\{derived\}/);
  });

  it('grid/freeform save calls saveCustomLayout and registerCustomLayout', () => {
    expect(shellSrc).toMatch(/saveCustomLayout\(def\)/);
    expect(shellSrc).toMatch(/registerCustomLayout\(/);
  });

  it('save builds grid def from GRID_TEMPLATES and current slots', () => {
    expect(shellSrc).toMatch(/GRID_TEMPLATES\[state\.activeTemplate\]/);
    expect(shellSrc).toMatch(/slots: state\.slots/);
  });

  it('save builds freeform def from freePanels', () => {
    expect(shellSrc).toMatch(/panels: state\.freePanels/);
  });

  it('shows toast after save with layout name', () => {
    expect(shellSrc).toMatch(/showToast\(/);
    expect(shellSrc).toMatch(/editor-toast/);
  });

  it('useCustomLayouts re-registers on storage event for smx-custom-layouts key', () => {
    expect(customHookSrc).toMatch(/e\.key === 'smx-custom-layouts'/);
    expect(customHookSrc).toMatch(/registerAll\(\)/);
    expect(customHookSrc).toMatch(/window\.addEventListener\('storage'/);
  });
});
