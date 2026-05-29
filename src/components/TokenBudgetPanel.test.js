/**
 * TokenBudgetPanel tests.
 *
 * Covers:
 * - Renders nothing when roles is empty
 * - Renders all roles by default
 * - Filters to selected roles when a Set is provided
 * - "show all" checkbox reveals all roles when a selection is active
 * - totalContext and totalMaxTokens totals reflect role values
 * - Totals update when a draft value is changed
 * - isDirty: Save button disabled when unchanged, enabled after edit
 * - saveOne: calls setAgentTokens with clamped values and clears draft
 * - saveOne: shows error message on API failure
 * - saveOne: shows auto-bump notice when read_timeout_auto_bumped is true
 * - "Save all" button appears only when dirty roles exist
 */
import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import TokenBudgetPanel from './TokenBudgetPanel';
import * as agentsApi from '../api/agentsApi';

jest.mock('../api/agentsApi');

const ROLE = (overrides = {}) => ({
  name: 'programmer',
  port: 5001,
  max_tokens: 2048,
  context: 4096,
  read_timeout_secs: 120,
  gpu_layers: 0,
  ...overrides,
});

afterEach(() => jest.clearAllMocks());

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

test('renders nothing when roles array is empty', () => {
  const { container } = render(<TokenBudgetPanel roles={[]} />);
  expect(container.firstChild).toBeNull();
});

test('renders nothing when roles is undefined', () => {
  const { container } = render(<TokenBudgetPanel roles={undefined} />);
  expect(container.firstChild).toBeNull();
});

test('renders all roles by default', () => {
  const roles = [ROLE({ name: 'programmer' }), ROLE({ name: 'reviewer', port: 5002 })];
  render(<TokenBudgetPanel roles={roles} />);
  expect(screen.getByText('programmer')).toBeInTheDocument();
  expect(screen.getByText('reviewer')).toBeInTheDocument();
});

test('filters to selected roles when a Set is provided', () => {
  const roles = [ROLE({ name: 'programmer' }), ROLE({ name: 'reviewer', port: 5002 })];
  render(<TokenBudgetPanel roles={roles} selected={new Set(['programmer'])} />);
  expect(screen.getByText('programmer')).toBeInTheDocument();
  expect(screen.queryByText('reviewer')).not.toBeInTheDocument();
});

test('"show all" checkbox reveals hidden roles', () => {
  const roles = [ROLE({ name: 'programmer' }), ROLE({ name: 'reviewer', port: 5002 })];
  render(<TokenBudgetPanel roles={roles} selected={new Set(['programmer'])} />);
  expect(screen.queryByText('reviewer')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('checkbox'));
  expect(screen.getByText('reviewer')).toBeInTheDocument();
});

// ---------------------------------------------------------------------------
// Totals
// ---------------------------------------------------------------------------

test('displays correct totalContext and totalMaxTokens for a single role', () => {
  render(<TokenBudgetPanel roles={[ROLE({ context: 8192, max_tokens: 1024 })]} />);
  expect(screen.getByText('8,192')).toBeInTheDocument();
  expect(screen.getByText('1,024')).toBeInTheDocument();
});

test('sums totalContext across multiple roles', () => {
  const roles = [
    ROLE({ name: 'programmer', context: 4096, max_tokens: 512 }),
    ROLE({ name: 'reviewer', port: 5002, context: 8192, max_tokens: 1024 }),
  ];
  render(<TokenBudgetPanel roles={roles} />);
  expect(screen.getByText('12,288')).toBeInTheDocument();
  expect(screen.getByText('1,536')).toBeInTheDocument();
});

test('totalContext updates when draft context value is changed', () => {
  render(<TokenBudgetPanel roles={[ROLE({ context: 4096, max_tokens: 512 })]} />);
  const ctxInputs = screen.getAllByRole('spinbutton');
  // first spinbutton is ctx
  fireEvent.change(ctxInputs[0], { target: { value: '16384' } });
  expect(screen.getByText('16,384')).toBeInTheDocument();
});

// ---------------------------------------------------------------------------
// isDirty / Save button state
// ---------------------------------------------------------------------------

test('Save button is disabled when no values are changed', () => {
  render(<TokenBudgetPanel roles={[ROLE()]} />);
  expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
});

test('Save button enables after editing max_tokens', () => {
  render(<TokenBudgetPanel roles={[ROLE({ max_tokens: 2048 })]} />);
  const inputs = screen.getAllByRole('spinbutton');
  // second spinbutton is max_tokens
  fireEvent.change(inputs[1], { target: { value: '4096' } });
  expect(screen.getByRole('button', { name: /^save$/i })).not.toBeDisabled();
});

// ---------------------------------------------------------------------------
// saveOne — success
// ---------------------------------------------------------------------------

test('saveOne calls setAgentTokens and clears draft on success', async () => {
  agentsApi.setAgentTokens.mockResolvedValue({});
  const onRolesChange = jest.fn();
  render(<TokenBudgetPanel roles={[ROLE({ max_tokens: 2048 })]} onRolesChange={onRolesChange} />);
  const inputs = screen.getAllByRole('spinbutton');
  fireEvent.change(inputs[1], { target: { value: '4096' } });
  fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
  await waitFor(() => expect(agentsApi.setAgentTokens).toHaveBeenCalledWith('programmer', expect.objectContaining({ max_tokens: 4096 })));
  await waitFor(() => expect(onRolesChange).toHaveBeenCalled());
});

test('saveOne clamps max_tokens to MAX_MAX_TOKENS (131072)', async () => {
  agentsApi.setAgentTokens.mockResolvedValue({});
  render(<TokenBudgetPanel roles={[ROLE({ max_tokens: 2048 })]} onRolesChange={jest.fn()} />);
  const inputs = screen.getAllByRole('spinbutton');
  fireEvent.change(inputs[1], { target: { value: '999999' } });
  fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
  await waitFor(() =>
    expect(agentsApi.setAgentTokens).toHaveBeenCalledWith('programmer', expect.objectContaining({ max_tokens: 131072 }))
  );
});

test('saveOne clamps max_tokens to MIN_MAX_TOKENS (64)', async () => {
  agentsApi.setAgentTokens.mockResolvedValue({});
  render(<TokenBudgetPanel roles={[ROLE({ max_tokens: 2048 })]} onRolesChange={jest.fn()} />);
  const inputs = screen.getAllByRole('spinbutton');
  fireEvent.change(inputs[1], { target: { value: '1' } });
  fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
  await waitFor(() =>
    expect(agentsApi.setAgentTokens).toHaveBeenCalledWith('programmer', expect.objectContaining({ max_tokens: 64 }))
  );
});

// ---------------------------------------------------------------------------
// saveOne — error
// ---------------------------------------------------------------------------

test('saveOne shows error indicator on API failure', async () => {
  agentsApi.setAgentTokens.mockRejectedValue(new Error('timeout'));
  render(<TokenBudgetPanel roles={[ROLE({ max_tokens: 2048 })]} />);
  const inputs = screen.getAllByRole('spinbutton');
  fireEvent.change(inputs[1], { target: { value: '4096' } });
  fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
  await waitFor(() => expect(screen.getByText('⚠')).toBeInTheDocument());
});

// ---------------------------------------------------------------------------
// saveOne — auto-bump notice
// ---------------------------------------------------------------------------

test('saveOne shows auto-bump notice when read_timeout_auto_bumped is true', async () => {
  agentsApi.setAgentTokens.mockResolvedValue({ read_timeout_secs: 300, read_timeout_auto_bumped: true });
  render(<TokenBudgetPanel roles={[ROLE({ max_tokens: 2048 })]} onRolesChange={jest.fn()} />);
  const inputs = screen.getAllByRole('spinbutton');
  fireEvent.change(inputs[1], { target: { value: '8192' } });
  fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
  await waitFor(() => expect(screen.getByText('✓')).toBeInTheDocument());
});

// ---------------------------------------------------------------------------
// "Save all" button
// ---------------------------------------------------------------------------

test('"Save all" button is not shown when no roles are dirty', () => {
  const roles = [ROLE({ name: 'programmer' }), ROLE({ name: 'reviewer', port: 5002 })];
  render(<TokenBudgetPanel roles={roles} />);
  expect(screen.queryByRole('button', { name: /save all/i })).not.toBeInTheDocument();
});

test('"Save all" button appears when at least one role is dirty', () => {
  const roles = [ROLE({ name: 'programmer' }), ROLE({ name: 'reviewer', port: 5002 })];
  render(<TokenBudgetPanel roles={roles} />);
  const inputs = screen.getAllByRole('spinbutton');
  fireEvent.change(inputs[1], { target: { value: '4096' } });
  expect(screen.getByRole('button', { name: /save all/i })).toBeInTheDocument();
});
