// Pure helpers and constants extracted from SwarmConfig.js.
// No React, no I/O — every export is deterministic given its inputs so it can
// be tested in isolation and reused by sibling modules (risk, deploy).

export const shortName = p => p.replace(/\.gguf$/, '').split('/').pop();

export const isAppleSilicon =
  typeof navigator !== 'undefined' && (
    navigator.platform === 'MacIntel' ||
    (navigator.userAgent.includes('Mac') && navigator.userAgent.includes('ARM'))
  );

export const ENGINES = [
  { id: 'llama', label: 'LLAMA', backend: 'llama' },
  { id: 'mlx',   label: 'MLX',   backend: 'mlx'   },
  { id: 'vllm',  label: 'vLLM',  backend: 'vllm'  },
];

export const PROFILE_CUSTOM   = 'custom';
export const PROFILE_SAFE     = 'safe';
export const PROFILE_BALANCED = 'balanced';
export const PROFILE_MAX      = 'max';
export const PROFILE_MIXED    = 'mixed';

/** [id, label] pairs for profile dropdowns (BrewConfigPanel). */
export const PROFILES = [
  [PROFILE_SAFE,     'Safe'],
  [PROFILE_BALANCED, 'Balanced'],
  [PROFILE_MAX,      'Max'],
  [PROFILE_MIXED,    'Mixed'],
  [PROFILE_CUSTOM,   'Custom'],
];

export function getEngineLabel(engineId) {
  return ENGINES.find(e => e.id === engineId)?.label ?? engineId;
}

// Layout + profile + model helpers — re-exported for callers that import from here
export { parseModelSizeBillions, computeLayout, getProfileRoles, chooseModelForRole } from './SwarmConfig.layoutHelpers';
