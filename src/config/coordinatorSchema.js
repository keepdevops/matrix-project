/**
 * Canonical coordinator config shapes for swarm-config.json / PUT payloads.
 * Mirror of server validation in src2/config/coordinator_config_validate.cpp
 * and routes in coordinator_routes_modes.cpp — update both when adding keys.
 */

/** Mode names registered by the coordinator binary (link-time). */
export const REGISTERED_MODE_NAMES = ['flat', 'pipeline', 'cascade', 'router'];

/** Optional keys under coordinator.modes.<mode> (types are advisory for tooling). */
export const MODE_CONFIG_SHAPE = {
  flat: {
    agents: 'string[] (ignored at dispatch — flat uses full swarm)',
    variant_policy: 'string',
  },
  pipeline: {
    agents: 'string[]',
    order: 'string[]',
    preset: 'string',
    synthesizer: 'string',
    stage_context_chars: 'number',
  },
  cascade: {
    agents: 'string[]',
    synthesizer: 'string',
    synthesis_policy: 'string',
  },
  router: {
    agents: 'string[]',
    max_select: 'number',
    classifier_policy: 'string',
  },
};

/** Preset bundle keys written by PUT /api/presets/:name */
export const PRESET_SHAPE = {
  mode: 'string',
  agents: 'string[]',
  synthesizer: 'string',
  max_select: 'number',
};
