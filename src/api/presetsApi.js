import { API_BASE } from './base';
import { fetchPresets, savePreset } from './agentsApi';

export { fetchPresets, savePreset };

export async function exportPreset(name) {
  const url = `${API_BASE}/presets/${encodeURIComponent(name)}/export`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Export failed (${res.status})`);
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export async function importPreset(name, data) {
  await savePreset(name, data);
}

export async function duplicatePreset(srcName, dstName) {
  const all = await fetchPresets();
  if (!all[srcName]) throw new Error(`Preset "${srcName}" not found`);
  await savePreset(dstName, all[srcName]);
}
