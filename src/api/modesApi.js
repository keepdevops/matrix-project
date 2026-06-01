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
