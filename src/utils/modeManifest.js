import { MODE_MANIFEST } from './modeManifestData';

const DEFAULT_META = { backend: 'cpp', enabled: true, ui: true };

/**
 * Merge coordinator /api/modes entries with MS-24 mode manifest metadata.
 * Drops modes marked ui:false or enabled:false.
 */
export function applyModeManifest(apiModes) {
  if (!Array.isArray(apiModes)) return [];
  return apiModes
    .map((m) => {
      const meta = MODE_MANIFEST[m.name] || DEFAULT_META;
      return {
        ...m,
        backend: meta.backend || DEFAULT_META.backend,
        enabled: meta.enabled !== false,
        ui: meta.ui !== false,
        manifestNote: meta.note || null,
      };
    })
    .filter((m) => m.enabled && m.ui);
}

export function getModeManifestEntry(name) {
  return MODE_MANIFEST[name] || DEFAULT_META;
}

export { MODE_MANIFEST };
