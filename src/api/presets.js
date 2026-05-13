import { API_BASE } from './apiBase';

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
  const response = await fetch(`${API_BASE}/presets/${encodeURIComponent(name)}`, { method: 'DELETE' });
  if (!response.ok) throw new Error(`Failed to delete preset: ${response.status}`);
  return response.json();
}

export async function applyPreset(name) {
  const response = await fetch(`${API_BASE}/presets/${encodeURIComponent(name)}/apply`, { method: 'POST' });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Failed to apply preset: ${response.status}`);
  }
  return response.json();
}
