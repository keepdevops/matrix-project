import { API_BASE } from './base';

export async function fetchTemplates() {
  const res = await fetch(`${API_BASE}/templates`);
  if (!res.ok) throw new Error(`fetchTemplates failed (${res.status})`);
  return res.json();
}

export async function saveTemplate(name, data) {
  const res = await fetch(`${API_BASE}/templates/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`saveTemplate failed (${res.status})`);
  return res.json();
}

export async function deleteTemplate(name) {
  const res = await fetch(`${API_BASE}/templates/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(`deleteTemplate failed (${res.status})`);
  return res.json();
}

export async function renderTemplate(name, variables) {
  const res = await fetch(
    `${API_BASE}/templates/${encodeURIComponent(name)}/render`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ variables }) }
  );
  if (!res.ok) throw new Error(`renderTemplate failed (${res.status})`);
  return res.json();
}
