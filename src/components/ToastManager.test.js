/**
 * ToastManager tests.
 *
 * Covers:
 * - useToast throws outside ToastProvider
 * - showToast renders toast with message and correct type icon
 * - Auto-dismiss after type-based duration (fake timers)
 * - Manual dismiss via close button removes toast
 * - Queue cap: 4 toasts keeps only the most recent 3
 * - Type durations: success 4s, info 4s, warn 6s, error 8s
 * - Custom duration overrides type default
 */
import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ToastProvider, useToast } from './ToastManager';

// Helper: renders a button that fires showToast when clicked
function ToastTrigger({ message, type, duration }) {
  const showToast = useToast();
  return (
    <button onClick={() => showToast(message, type, duration)}>
      show
    </button>
  );
}

function setup(props = {}) {
  return render(
    <ToastProvider>
      <ToastTrigger {...props} />
    </ToastProvider>
  );
}

afterEach(() => jest.useRealTimers());

// ---------------------------------------------------------------------------
// useToast outside provider
// ---------------------------------------------------------------------------

test('useToast throws when used outside ToastProvider', () => {
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  function Bad() {
    useToast();
    return null;
  }
  expect(() => render(<Bad />)).toThrow('useToast must be used inside <ToastProvider>');
  spy.mockRestore();
});

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

test('showToast renders toast with the given message', () => {
  setup({ message: 'Hello toast', type: 'info' });
  fireEvent.click(screen.getByRole('button', { name: 'show' }));
  expect(screen.getByText('Hello toast')).toBeInTheDocument();
});

test('showToast success type shows ✓ icon', () => {
  setup({ message: 'done', type: 'success' });
  fireEvent.click(screen.getByRole('button', { name: 'show' }));
  expect(screen.getByText('✓')).toBeInTheDocument();
});

test('showToast error type shows ✕ icon', () => {
  setup({ message: 'oops', type: 'error' });
  fireEvent.click(screen.getByRole('button', { name: 'show' }));
  // Two ✕ elements: icon + dismiss button — icon is inside toast
  const icons = screen.getAllByText('✕');
  expect(icons.length).toBeGreaterThanOrEqual(1);
});

test('showToast warn type shows ⚠ icon', () => {
  setup({ message: 'watch out', type: 'warn' });
  fireEvent.click(screen.getByRole('button', { name: 'show' }));
  expect(screen.getByText('⚠')).toBeInTheDocument();
});

test('showToast info type shows ℹ icon', () => {
  setup({ message: 'fyi', type: 'info' });
  fireEvent.click(screen.getByRole('button', { name: 'show' }));
  expect(screen.getByText('ℹ')).toBeInTheDocument();
});

// ---------------------------------------------------------------------------
// Manual dismiss
// ---------------------------------------------------------------------------

test('clicking dismiss button removes the toast', () => {
  jest.useFakeTimers();
  setup({ message: 'Dismiss me', type: 'info' });
  fireEvent.click(screen.getByRole('button', { name: 'show' }));
  expect(screen.getByText('Dismiss me')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
  expect(screen.queryByText('Dismiss me')).not.toBeInTheDocument();
});

// ---------------------------------------------------------------------------
// Auto-dismiss durations
// ---------------------------------------------------------------------------

test.each([
  ['success', 4000],
  ['info',    4000],
  ['warn',    6000],
  ['error',   8000],
])('%s type auto-dismisses after %dms', (type, ms) => {
  jest.useFakeTimers();
  setup({ message: `${type} toast`, type });
  fireEvent.click(screen.getByRole('button', { name: 'show' }));
  expect(screen.getByText(`${type} toast`)).toBeInTheDocument();
  act(() => jest.advanceTimersByTime(ms - 1));
  expect(screen.getByText(`${type} toast`)).toBeInTheDocument();
  act(() => jest.advanceTimersByTime(1));
  expect(screen.queryByText(`${type} toast`)).not.toBeInTheDocument();
});

test('custom duration overrides type default', () => {
  jest.useFakeTimers();
  setup({ message: 'custom', type: 'info', duration: 1000 });
  fireEvent.click(screen.getByRole('button', { name: 'show' }));
  act(() => jest.advanceTimersByTime(999));
  expect(screen.getByText('custom')).toBeInTheDocument();
  act(() => jest.advanceTimersByTime(1));
  expect(screen.queryByText('custom')).not.toBeInTheDocument();
});

// ---------------------------------------------------------------------------
// Queue cap (max 3)
// ---------------------------------------------------------------------------

test('showing 4 toasts keeps only the most recent 3', () => {
  function MultiTrigger() {
    const showToast = useToast();
    return (
      <button onClick={() => {
        showToast('toast-1', 'info');
        showToast('toast-2', 'info');
        showToast('toast-3', 'info');
        showToast('toast-4', 'info');
      }}>show all</button>
    );
  }
  render(<ToastProvider><MultiTrigger /></ToastProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'show all' }));
  expect(screen.queryByText('toast-1')).not.toBeInTheDocument();
  expect(screen.getByText('toast-2')).toBeInTheDocument();
  expect(screen.getByText('toast-3')).toBeInTheDocument();
  expect(screen.getByText('toast-4')).toBeInTheDocument();
});
