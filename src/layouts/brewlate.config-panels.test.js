/**
 * BL1-4 — Configuration panels deep testing.
 * Covers: useBrewEditRoleModal save flow, useBrewRoleHandlers state transitions,
 * BrewAgentsPopout ARIA/close, BrewEditRoleModal structure, layout persistence.
 */
const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

const modalHookSrc    = read('layouts/useBrewEditRoleModal.js');
const roleHandlersSrc = read('layouts/useBrewRoleHandlers.js');
const popoutSrc       = read('layouts/BrewAgentsPopout.js');
const modalSrc        = read('layouts/BrewEditRoleModal.js');
const tabsSrc         = read('layouts/BrewEditRoleModalTabs.js');
const controlsSrc     = read('layouts/BrewEditRoleModalControls.js');
const persistSrc      = read('hooks/useLayoutPreference.js');

// ── useBrewEditRoleModal — save flow ─────────────────────────────────────────

describe('useBrewEditRoleModal — save flow', () => {
  it('rename guard sets error and returns before any API call', () => {
    expect(modalHookSrc).toMatch(/name\.trim\(\) !== agentName/);
    expect(modalHookSrc).toMatch(/setError\('Renaming agents is not supported/);
    // guard returns before setBusy(true), so return precedes API calls
    const guardIdx = modalHookSrc.indexOf("name.trim() !== agentName");
    const busyIdx  = modalHookSrc.indexOf("setBusy(true)");
    expect(guardIdx).toBeGreaterThan(-1);
    expect(busyIdx).toBeGreaterThan(guardIdx);
  });

  it('only calls setAgentSystemPrompt when prompt is dirty', () => {
    expect(modalHookSrc).toMatch(/const promptDirty = prompt !== \(role\.system_prompt \|\| ''\)/);
    expect(modalHookSrc).toMatch(/if \(promptDirty\)/);
    expect(modalHookSrc).toMatch(/setAgentSystemPrompt\(agentName, prompt\)/);
  });

  it('only calls setAgentTokens when context or max_tokens changed', () => {
    expect(modalHookSrc).toMatch(/const ctxDirty = ctxVal !== \(role\.context \?\? 0\)/);
    expect(modalHookSrc).toMatch(/const tokDirty/);
    expect(modalHookSrc).toMatch(/if \(ctxDirty \|\| tokDirty\)/);
    expect(modalHookSrc).toMatch(/setAgentTokens\(agentName, body\)/);
  });

  it('always patches temperature, min_p, top_p, top_k, permissions on save', () => {
    expect(modalHookSrc).toMatch(/patch\.temperature = parseFloat\(temp\)/);
    expect(modalHookSrc).toMatch(/patch\.min_p\s+=\s+parseFloat\(minP\)/);
    expect(modalHookSrc).toMatch(/patch\.top_p\s+=\s+parseFloat\(topP\)/);
    expect(modalHookSrc).toMatch(/patch\.top_k\s+=\s+parseInt\(topK/);
    expect(modalHookSrc).toMatch(/patch\.permissions = \{ \.\.\.perms \}/);
  });

  it('calls onSaved with partial patch in catch block (partial-save on error)', () => {
    expect(modalHookSrc).toMatch(/if \(Object\.keys\(patch\)\.length > 1\) onSaved\(patch\)/);
  });

  it('calls onClose after successful save', () => {
    expect(modalHookSrc).toMatch(/onSaved\(patch\);\s*\n\s*onClose\(\)/);
  });

  it('clears busy in finally block regardless of outcome', () => {
    expect(modalHookSrc).toMatch(/finally \{[\s\S]*?setBusy\(false\)/);
  });
});

// ── useBrewRoleHandlers — state transitions ───────────────────────────────────

describe('useBrewRoleHandlers — state transitions', () => {
  it('handleEngineChange resets selection and roleModels', () => {
    expect(roleHandlersSrc).toMatch(/setSelected\(new Set\(\)\)/);
    expect(roleHandlersSrc).toMatch(/setRoleModels\(\{\}\)/);
    expect(roleHandlersSrc).toMatch(/setActiveProfile\(PROFILE_CUSTOM\)/);
  });

  it('toggleRole auto-assigns a model via chooseModelForRole on add', () => {
    expect(roleHandlersSrc).toMatch(/chooseModelForRole\(name/);
    expect(roleHandlersSrc).toMatch(/if \(path\) setRoleModels/);
  });

  it('toggleRole removes agent on second toggle (delete branch)', () => {
    expect(roleHandlersSrc).toMatch(/next\.delete\(name\)/);
    expect(roleHandlersSrc).toMatch(/next\.add\(name\)/);
  });

  it('setModel updates roleModels and resets profile to Custom', () => {
    expect(roleHandlersSrc).toMatch(/setRoleModels\(prev => \(\{ \.\.\.prev, \[name\]: model \}\)\)/);
    const setModelBlock = roleHandlersSrc.match(/const setModel = useCallback[\s\S]*?\}, \[/)?.[0] || '';
    expect(setModelBlock).toMatch(/setActiveProfile\(PROFILE_CUSTOM\)/);
  });

  it('applyProfile(PROFILE_CUSTOM) is a no-op on selection — early return', () => {
    expect(roleHandlersSrc).toMatch(/if \(profileId === PROFILE_CUSTOM\) \{ setActiveProfile\(PROFILE_CUSTOM\); return; \}/);
  });

  it('applyProfile non-custom calls setSelected + setRoleModels + setActiveProfile', () => {
    expect(roleHandlersSrc).toMatch(/setSelected\(new Set\(picked\)\)/);
    expect(roleHandlersSrc).toMatch(/setRoleModels\(nextModels\)/);
    expect(roleHandlersSrc).toMatch(/setActiveProfile\(profileId\)/);
  });

  it('applyProfile calls reset() to sync deploy state', () => {
    expect(roleHandlersSrc).toMatch(/reset\?\.\(\)/);
  });

  it('selectAllRoles picks models for all roles and selects all', () => {
    expect(roleHandlersSrc).toMatch(/setSelected\(new Set\(roles\.map\(r => r\.name\)\)\)/);
    expect(roleHandlersSrc).toMatch(/setRoleModels\(prev => \(\{ \.\.\.prev, \.\.\.nextModels \}\)\)/);
  });

  it('clearAllRoles empties selection', () => {
    const clearBlock = roleHandlersSrc.match(/const clearAllRoles = useCallback[\s\S]*?\}, \[/)?.[0] || '';
    expect(clearBlock).toMatch(/setSelected\(new Set\(\)\)/);
  });
});

// ── BrewAgentsPopout — ARIA and close behaviour ───────────────────────────────

describe('BrewAgentsPopout — ARIA and close behaviour', () => {
  it('has role=dialog with aria-label', () => {
    expect(popoutSrc).toMatch(/role="dialog"/);
    expect(popoutSrc).toMatch(/aria-label="Agent token budgets"/);
  });

  it('has a close button with aria-label', () => {
    expect(popoutSrc).toMatch(/brew-header-btn/);
    expect(popoutSrc).toMatch(/aria-label="Close"/);
  });

  it('closes on Escape key', () => {
    expect(popoutSrc).toMatch(/e\.key === 'Escape'/);
    expect(popoutSrc).toMatch(/onClose\?\.\(\)/);
  });

  it('closes on outside mousedown, ignoring trigger clicks', () => {
    expect(popoutSrc).toMatch(/brew-agents-popout-trigger/);
    expect(popoutSrc).toMatch(/rootRef\.current\?\.contains\(e\.target\)/);
  });

  it('renders TokenBudgetPanel with roles and selected', () => {
    expect(popoutSrc).toMatch(/TokenBudgetPanel/);
    expect(popoutSrc).toMatch(/roles=\{roles\}/);
    expect(popoutSrc).toMatch(/selected=\{selected\}/);
    expect(popoutSrc).toMatch(/onRolesChange=\{onRolesChange\}/);
  });
});

// ── BrewEditRoleModal — structure and tabs ────────────────────────────────────

describe('BrewEditRoleModal — structure and tabs', () => {
  it('renders three tabs: Basic, Advanced, Tools', () => {
    expect(modalSrc).toMatch(/'Basic'/);
    expect(modalSrc).toMatch(/'Advanced'/);
    expect(modalSrc).toMatch(/'Tools'/);
    expect(modalSrc).toMatch(/brew-modal-tab/);
  });

  it('has aria-modal and aria-label on the card', () => {
    expect(modalSrc).toMatch(/aria-modal="true"/);
    expect(modalSrc).toMatch(/aria-label=\{`Edit role \$\{role\.name\}`\}/);
  });

  it('Save Changes and Cancel buttons are present', () => {
    expect(modalSrc).toMatch(/Save Changes/);
    expect(modalSrc).toMatch(/Cancel/);
    expect(modalSrc).toMatch(/brew-modal-btn--save/);
    expect(modalSrc).toMatch(/brew-modal-btn--cancel/);
  });

  it('Save button disabled while busy; shows Saving… label', () => {
    expect(modalSrc).toMatch(/disabled=\{busy\}/);
    expect(modalSrc).toMatch(/busy \? 'Saving…' : 'Save Changes'/);
  });

  it('Basic tab has name, prompt, model, context fields', () => {
    expect(tabsSrc).toMatch(/brew-role-name/);
    expect(tabsSrc).toMatch(/brew-role-prompt/);
    expect(tabsSrc).toMatch(/brew-role-model/);
    expect(tabsSrc).toMatch(/brew-role-ctx/);
  });

  it('Advanced tab has Temperature and Min-P sliders', () => {
    expect(tabsSrc).toMatch(/label="Temperature"/);
    expect(tabsSrc).toMatch(/label="Min-P"/);
    expect(tabsSrc).toMatch(/label="Top-P"/);
  });

  it('SliderRow and Toggle controls are defined', () => {
    expect(controlsSrc).toMatch(/export function SliderRow/);
    expect(controlsSrc).toMatch(/export function Toggle/);
  });

  it('Tools tab uses perms and togglePerm inline', () => {
    // BrewToolsTab loops over perms and calls togglePerm inline — no prop forwarding
    expect(tabsSrc).toMatch(/perms\[key\]/);
    expect(tabsSrc).toMatch(/togglePerm\(key\)/);
    expect(tabsSrc).toMatch(/BrewToolsTab/);
    // Modal correctly forwards both to the tab
    expect(modalSrc).toMatch(/perms=\{perms\}/);
    expect(modalSrc).toMatch(/togglePerm=\{togglePerm\}/);
  });
});

// ── Layout persistence (localStorage + URL) ───────────────────────────────────

describe('Layout persistence — localStorage and URL', () => {
  it('reads layout from URL ?layout= param first', () => {
    expect(persistSrc).toMatch(/readParam\('layout'\)/);
    expect(persistSrc).toMatch(/new URLSearchParams\(window\.location\.search\)\.get\(name\)/);
  });

  it('falls back to localStorage key swarm-matrix-layout', () => {
    expect(persistSrc).toMatch(/STORAGE_LAYOUT = 'swarm-matrix-layout'/);
    expect(persistSrc).toMatch(/readStorage\(STORAGE_LAYOUT\)/);
  });

  it('default layout is brewlate', () => {
    expect(persistSrc).toMatch(/DEFAULT_LAYOUT = 'brewlate'/);
  });

  it("normalises legacy 'default' id to brewlate", () => {
    expect(persistSrc).toMatch(/id === 'default'\) return DEFAULT_LAYOUT/);
  });

  it('writes layout to localStorage on setLayout', () => {
    expect(persistSrc).toMatch(/writeStorage\(STORAGE_LAYOUT, safe\)/);
  });

  it('syncs ?layout= and ?theme= into URL via replaceState', () => {
    expect(persistSrc).toMatch(/params\.set\('layout', layout\)/);
    expect(persistSrc).toMatch(/params\.set\('theme', theme\)/);
    expect(persistSrc).toMatch(/replaceState/);
  });

  it('logs and does not throw on localStorage write failure', () => {
    expect(persistSrc).toMatch(/console\.error\('useLayoutPreference: localStorage write failed/);
  });

  it('logs and does not throw on URL sync failure', () => {
    expect(persistSrc).toMatch(/console\.error\('useLayoutPreference: URL sync failed/);
  });
});
