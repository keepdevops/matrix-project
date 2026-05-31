import { API_BASE, coalesce } from './base';

export async function fetchModes() {
  return coalesce('modes', async () => {
    const response = await fetch(`${API_BASE}/modes`);
    if (!response.ok) throw new Error(`Failed to fetch modes: ${response.status}`);
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  });
}

export async function fetchActiveMode() {
  const response = await fetch(`${API_BASE}/modes/active`);
  if (!response.ok) throw new Error(`Failed to fetch active mode: ${response.status}`);
  const j = await response.json();
  return j.mode || null;
}

export async function setActiveMode(name) {
  const response = await fetch(`${API_BASE}/modes/active`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: name }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Failed to set mode: ${response.status}`);
  }
  return response.json();
}

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

export async function setAgentTokens(name, { max_tokens, context, read_timeout_secs } = {}) {
  const body = {};
  if (Number.isFinite(max_tokens)) body.max_tokens = max_tokens;
  if (Number.isFinite(context)) body.context = context;
  if (Number.isFinite(read_timeout_secs)) body.read_timeout_secs = read_timeout_secs;
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

export async function fetchModeAgents(name) {
  const response = await fetch(`${API_BASE}/modes/${encodeURIComponent(name)}/agents`);
  if (!response.ok) throw new Error(`Failed to fetch mode agents: ${response.status}`);
  const data = await response.json();
  if (!data || typeof data !== 'object') return { agents: [], available: [], stale: [] };
  return {
    ...data,
    agents:    Array.isArray(data.agents)    ? data.agents    : [],
    available: Array.isArray(data.available) ? data.available : [],
    stale:     Array.isArray(data.stale)     ? data.stale     : [],
  };
}

export async function setModeAgents(name, agentNames, opts = {}) {
  const body = { agents: agentNames };
  if (Number.isInteger(opts.maxSelect)) body.max_select = opts.maxSelect;
  if (opts.synthesizer !== undefined) body.synthesizer = opts.synthesizer ?? null;
  ['variant_policy', 'preset', 'synthesis_policy', 'classifier_policy'].forEach(key => {
    if (opts[key] !== undefined) body[key] = opts[key] ?? null;
  });
  if (Number.isInteger(opts.stage_context_chars)) body.stage_context_chars = opts.stage_context_chars;
  if (Array.isArray(opts.order)) body.order = opts.order;
  else if (opts.order === null) body.order = null;
  const response = await fetch(`${API_BASE}/modes/${encodeURIComponent(name)}/agents`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Failed to set mode agents: ${response.status}`);
  }
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
