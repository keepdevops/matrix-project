import { API_BASE, coalesce } from './base';

// Mode-related endpoints live in modesApi.js; re-exported here for backwards compat.
export { fetchModes, fetchActiveMode, setActiveMode, fetchModeAgents, setModeAgents } from './modesApi';

export async function setAgentSystemPrompt(name, systemPrompt) {
  const response = await fetch(`${API_BASE}/agents/${encodeURIComponent(name)}/prompt`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ system_prompt: systemPrompt }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Failed to update agent prompt: ${response.status}`);
  }
  return response.json();
}

export async function setAgentDescription(name, description) {
  const response = await fetch(`${API_BASE}/agents/${encodeURIComponent(name)}/description`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Failed to update agent description: ${response.status}`);
  }
  return response.json();
}

export async function setAgentTokens(name, {
  max_tokens, context, read_timeout_secs,
  gpu_layers, max_concurrency, max_input_tokens, max_output_tokens,
} = {}) {
  const body = {};
  if (Number.isFinite(max_tokens)) body.max_tokens = max_tokens;
  if (Number.isFinite(context)) body.context = context;
  if (Number.isFinite(read_timeout_secs)) body.read_timeout_secs = read_timeout_secs;
  if (Number.isFinite(gpu_layers)) body.gpu_layers = gpu_layers;
  if (Number.isFinite(max_concurrency)) body.max_concurrency = max_concurrency;
  if (Number.isFinite(max_input_tokens)) body.max_input_tokens = max_input_tokens;
  if (Number.isFinite(max_output_tokens)) body.max_output_tokens = max_output_tokens;
  const response = await fetch(`${API_BASE}/agents/${encodeURIComponent(name)}/tokens`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Failed to update agent tokens: ${response.status}`);
  }
  return response.json();
}

export async function fetchPresets() {
  const response = await fetch(`${API_BASE}/presets`);
  if (!response.ok) throw new Error(`Failed to fetch presets: ${response.status}`);
  return response.json();
}

export async function savePreset(name, bundle) {
  const response = await fetch(`${API_BASE}/presets/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(bundle),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Failed to save preset: ${response.status}`);
  }
  return response.json();
}

export async function deletePreset(name) {
  const response = await fetch(`${API_BASE}/presets/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error(`Failed to delete preset: ${response.status}`);
  return response.json();
}

export async function applyPreset(name) {
  const response = await fetch(`${API_BASE}/presets/${encodeURIComponent(name)}/apply`, {
    method: 'POST',
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Failed to apply preset: ${response.status}`);
  }
  return response.json();
}

export async function fetchAgentHealth() {
  const response = await fetch(`${API_BASE}/health/agents`);
  if (!response.ok) throw new Error(`Failed to fetch agent health: ${response.status}`);
  return response.json();
}

export async function fetchHistory() {
  const response = await fetch(`${API_BASE}/history`);
  if (!response.ok) throw new Error(`Failed to fetch history: ${response.status}`);
  return response.json();
}

export async function fetchAgents() {
  return coalesce('agents', async () => {
    const response = await fetch(`${API_BASE}/agents`);
    if (!response.ok) throw new Error(`Failed to fetch agents: ${response.status}`);
    return response.json();
  });
}
