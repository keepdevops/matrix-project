import { renderHook, act } from '@testing-library/react';
import { useDeploy } from './SwarmConfig.deploy';
import { configureSwarm, fetchLogs, fetchConfigureStatus } from '../api/swarmApi';

jest.mock('../api/swarmApi', () => ({
  configureSwarm: jest.fn(),
  fetchLogs: jest.fn(),
  fetchConfigureStatus: jest.fn(),
}));

const LOW_RISK = {
  blockedGroups: [],
  band: { id: 'low', label: 'Low' },
  totalScore: 12,
};

const roles = [
  { name: 'architect', backend: 'llama', engine: 'llama' },
  { name: 'programmer', backend: 'llama', engine: 'llama' },
];

const models = [
  { path: '/m/7b.gguf', name: '7b', backend: 'llama' },
];

const baseArgs = () => ({
  roles,
  selected: new Set(['architect', 'programmer']),
  roleModels: { architect: '/m/7b.gguf', programmer: '/m/7b.gguf' },
  models,
  engine: 'llama',
  riskEstimate: LOW_RISK,
  layout: [{ port: 8080, model: '7b', agents: ['architect', 'programmer'], parallel: 2, engine: 'llama' }],
});

describe('useDeploy (Brew / LAUNCH SWARM)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    configureSwarm.mockResolvedValue({ ok: true });
    fetchConfigureStatus.mockResolvedValue({ active: false, ports: {} });
    fetchLogs.mockResolvedValue({ logs: [] });
  });

  it('rejects deploy when no agent has a model', async () => {
    const onDeployed = jest.fn();
    const { result } = renderHook(() => useDeploy({ onDeployed }));

    await act(async () => {
      await result.current.deploy({
        ...baseArgs(),
        selected: new Set(['architect']),
        roleModels: {},
      });
    });

    expect(result.current.status).toBe('error');
    expect(result.current.statusMsg).toMatch(/Select a model/i);
    expect(configureSwarm).not.toHaveBeenCalled();
    expect(onDeployed).not.toHaveBeenCalled();
  });

  it('blocks deploy when risk estimate has blocked groups', async () => {
    const { result } = renderHook(() => useDeploy({ onDeployed: jest.fn() }));

    await act(async () => {
      await result.current.deploy({
        ...baseArgs(),
        riskEstimate: {
          ...LOW_RISK,
          blockedGroups: [{ modelLabel: 'huge', effectiveCtx: 32768 }],
        },
      });
    });

    expect(result.current.status).toBe('error');
    expect(result.current.statusMsg).toMatch(/Launch blocked/i);
    expect(configureSwarm).not.toHaveBeenCalled();
  });

  it('calls configureSwarm and onDeployed on success', async () => {
    const onDeployed = jest.fn();
    const { result } = renderHook(() => useDeploy({ onDeployed }));

    await act(async () => {
      await result.current.deploy(baseArgs());
    });

    expect(configureSwarm).toHaveBeenCalledTimes(1);
    const agents = configureSwarm.mock.calls[0][0];
    expect(agents.map(a => a.name).sort()).toEqual(['architect', 'programmer']);
    expect(onDeployed).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('idle');
  });

  it('sets error status when configureSwarm fails', async () => {
    configureSwarm.mockRejectedValueOnce(new Error('proxy offline'));
    const { result } = renderHook(() => useDeploy({ onDeployed: jest.fn() }));

    await act(async () => {
      await result.current.deploy(baseArgs());
    });

    expect(result.current.status).toBe('error');
    expect(result.current.statusMsg).toBe('proxy offline');
  });

  it('reset clears deploying state', async () => {
    const { result } = renderHook(() => useDeploy({ onDeployed: jest.fn() }));
    act(() => result.current.reset());
    expect(result.current.status).toBe('idle');
    expect(result.current.statusMsg).toBe('');
    expect(result.current.agentStatuses.size).toBe(0);
  });
});
