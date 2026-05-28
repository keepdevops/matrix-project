/**
 * Chaos monkey tests — rapid/random inputs, broken env, edge cases.
 * Tests are intentionally self-contained to avoid ESM-incompatible deps
 * (CodeMirror etc.) that can't be transformed by Jest in CRA.
 */
import React from 'react';
import { render, act, fireEvent, renderHook } from '@testing-library/react';
import '@testing-library/jest-dom';
import Button from './components/Button';
import { ErrorBoundary } from './components/ErrorBoundary';

// ─── mock the layout registry so we never pull in CodeMirror ────────────────
jest.mock('./layouts/registry', () => ({
  THEMES: {
    dark: { label: '☾ Dark' },
    light: { label: '☀ Light' },
    overdrive: { label: '⚡ Overdrive' },
    synthwave: { label: '🌊 Synthwave' },
    cobalt: { label: '💎 Cobalt' },
    greyscale: { label: '◈ Greyscale' },
    'cvd-blue-orange':       { label: '⬡ CVD: Protanopia/Deuteranopia' },
    'cvd-teal-charcoal':     { label: '⬡ CVD: Tritanopia' },
    'cvd-amber':             { label: '⬡ CVD: Achromatopsia' },
    'cvd-light-blue-orange': { label: '⬡ CVD Light: Protanopia/Deuteranopia' },
    'cvd-light-tritanopia':  { label: '⬡ CVD Light: Tritanopia' },
    'cvd-light-amber':       { label: '⬡ CVD Light: Achromatopsia' },
  },
  LAYOUTS: {
    default:   { label: 'Default',   component: () => null },
    sidebar:   { label: 'Sidebar',   component: () => null },
    minimal:   { label: 'Minimal',   component: () => null },
    terminal:  { label: 'Terminal',  component: () => null },
    dashboard: { label: 'Dashboard', component: () => null },
  },
}));

import { useLayoutPreference } from './hooks/useLayoutPreference';
import { THEMES, LAYOUTS } from './layouts/registry';

// ─── constants ───────────────────────────────────────────────────────────────

const THEME_KEYS  = Object.keys(THEMES);
const LAYOUT_KEYS = Object.keys(LAYOUTS);
const BUTTON_VARIANTS = [
  'outline-primary', 'outline-accent', 'outline-warn',
  'outline-error', 'outline-orange', 'ghost', 'primary',
];

// ─── helpers ─────────────────────────────────────────────────────────────────

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function ThemeSwitcher({ themes }) {
  const { theme, setTheme } = useLayoutPreference();
  return (
    <div>
      <span data-testid="current-theme">{theme}</span>
      {themes.map(t => (
        <button key={t} data-testid={`theme-btn-${t}`} onClick={() => setTheme(t)}>{t}</button>
      ))}
    </div>
  );
}

function LayoutSwitcher({ layouts }) {
  const { layout, setLayout } = useLayoutPreference();
  return (
    <div>
      <span data-testid="current-layout">{layout}</span>
      {layouts.map(l => (
        <button key={l} data-testid={`layout-btn-${l}`} onClick={() => setLayout(l)}>{l}</button>
      ))}
    </div>
  );
}

function BombChild() {
  throw new Error('chaos: intentional render bomb');
}

// ─── setup / teardown ────────────────────────────────────────────────────────

beforeEach(() => {
  localStorage.clear();
  document.body.removeAttribute('data-theme');
  window.history.replaceState(null, '', '/');
});

// ─── Button ──────────────────────────────────────────────────────────────────

describe('Button — chaos', () => {
  it('renders every known variant without crashing', () => {
    BUTTON_VARIANTS.forEach(variant => {
      const { unmount } = render(<Button variant={variant}>label</Button>);
      unmount();
    });
  });

  it('renders unknown variant without crashing (graceful degradation)', () => {
    expect(() =>
      render(<Button variant="__does-not-exist__">label</Button>)
    ).not.toThrow();
  });

  it('handles rapid click spam without crashing', () => {
    let count = 0;
    const { getByText } = render(
      <Button variant="outline-primary" onClick={() => count++}>click</Button>
    );
    const btn = getByText('click');
    for (let i = 0; i < 200; i++) fireEvent.click(btn);
    expect(count).toBe(200);
  });

  it('renders with all sizes including unknown', () => {
    ['xs', 'sm', 'md', 'lg', 'xl', '__unknown__'].forEach(size => {
      const { unmount } = render(<Button size={size}>s</Button>);
      unmount();
    });
  });

  it('renders all variant × theme combinations without crashing', () => {
    THEME_KEYS.forEach(theme => {
      document.body.setAttribute('data-theme', theme);
      BUTTON_VARIANTS.forEach(variant => {
        const { unmount } = render(<Button variant={variant}>{variant}</Button>);
        unmount();
      });
    });
  });
});

// ─── ErrorBoundary ───────────────────────────────────────────────────────────

describe('ErrorBoundary — chaos', () => {
  let consoleError;
  beforeEach(() => { consoleError = jest.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(() => consoleError.mockRestore());

  it('catches a thrown child error and renders fallback', () => {
    const { getByText } = render(
      <ErrorBoundary><BombChild /></ErrorBoundary>
    );
    expect(getByText(/something went wrong/i)).toBeInTheDocument();
  });

  it('renders children normally when no error', () => {
    const { getByText } = render(
      <ErrorBoundary><span>safe</span></ErrorBoundary>
    );
    expect(getByText('safe')).toBeInTheDocument();
  });

  it('expand/collapse error details rapid-click without crash', () => {
    const { getByText } = render(
      <ErrorBoundary><BombChild /></ErrorBoundary>
    );
    const toggle = getByText(/show error details/i);
    for (let i = 0; i < 10; i++) fireEvent.click(toggle);
  });
});

// ─── useLayoutPreference ─────────────────────────────────────────────────────

describe('useLayoutPreference — chaos', () => {
  it('rapid theme switching across all themes applies data-theme attribute', () => {
    const order = shuffle(THEME_KEYS);
    const { getByTestId } = render(<ThemeSwitcher themes={THEME_KEYS} />);
    act(() => {
      order.forEach(t => fireEvent.click(getByTestId(`theme-btn-${t}`)));
    });
    const final = order[order.length - 1];
    expect(document.body.getAttribute('data-theme')).toBe(final);
    expect(getByTestId('current-theme').textContent).toBe(final);
  });

  it('rapid layout switching stays within valid keys', () => {
    const { getByTestId } = render(<LayoutSwitcher layouts={LAYOUT_KEYS} />);
    act(() => {
      shuffle(LAYOUT_KEYS).forEach(l => fireEvent.click(getByTestId(`layout-btn-${l}`)));
    });
    const currentLayout = getByTestId('current-layout').textContent;
    expect(LAYOUT_KEYS).toContain(currentLayout);
  });

  it('rejects unknown theme — falls back to dark', () => {
    const { result } = renderHook(() => useLayoutPreference());
    act(() => result.current.setTheme('__invalid_theme__'));
    expect(result.current.theme).toBe('dark');
    expect(document.body.getAttribute('data-theme')).toBe('dark');
  });

  it('rejects unknown layout — falls back to default', () => {
    const { result } = renderHook(() => useLayoutPreference());
    act(() => result.current.setLayout('__invalid_layout__'));
    expect(result.current.layout).toBe('default');
  });

  it('survives localStorage.setItem throwing', () => {
    const stub = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    const { result } = renderHook(() => useLayoutPreference());
    expect(() => act(() => result.current.setTheme('synthwave'))).not.toThrow();
    stub.mockRestore();
  });

  it('survives localStorage.getItem throwing', () => {
    const stub = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('security error');
    });
    expect(() => renderHook(() => useLayoutPreference())).not.toThrow();
    stub.mockRestore();
  });

  it('ignores unknown theme + layout in URL params — resolves to valid values', () => {
    window.history.replaceState(null, '', '/?theme=__bad__&layout=__bad__');
    const { result } = renderHook(() => useLayoutPreference());
    expect(THEME_KEYS).toContain(result.current.theme);
    expect(LAYOUT_KEYS).toContain(result.current.layout);
  });

  it('valid theme + layout in URL params are honoured', () => {
    window.history.replaceState(null, '', '/?theme=cobalt&layout=sidebar');
    const { result } = renderHook(() => useLayoutPreference());
    expect(result.current.theme).toBe('cobalt');
    expect(result.current.layout).toBe('sidebar');
  });

  it('persists last theme to localStorage after switching', () => {
    const { result } = renderHook(() => useLayoutPreference());
    act(() => result.current.setTheme('synthwave'));
    expect(localStorage.getItem('swarm-matrix-theme')).toBe('synthwave');
  });

  it('repeated same-theme calls are idempotent', () => {
    const { result } = renderHook(() => useLayoutPreference());
    act(() => {
      for (let i = 0; i < 50; i++) result.current.setTheme('cobalt');
    });
    expect(result.current.theme).toBe('cobalt');
  });

  it('all 12 themes can be set and data-theme matches', () => {
    const { result } = renderHook(() => useLayoutPreference());
    THEME_KEYS.forEach(t => {
      act(() => result.current.setTheme(t));
      expect(result.current.theme).toBe(t);
      expect(document.body.getAttribute('data-theme')).toBe(t);
    });
  });

  it('all 5 layouts can be set', () => {
    const { result } = renderHook(() => useLayoutPreference());
    LAYOUT_KEYS.forEach(l => {
      act(() => result.current.setLayout(l));
      expect(result.current.layout).toBe(l);
    });
  });
});
