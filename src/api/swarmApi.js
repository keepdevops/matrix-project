/**
 * Barrel re-export — all public API functions are implemented in the
 * domain modules below. Import from here or directly from the sub-module.
 */
export * from './ragApi';
export * from './streamApi';
// Direct re-exports for streamApi symbols that go through a nested chain
export { submitPromptStream, submitPromptStreamMlx } from './streamApi.stream';
export * from './agentsApi';
export * from './configApi';
export * from './configureApi';
export * from './orchestrateApi';
// Direct re-exports for modesApi symbols — webpack HMR loses nested re-export chains
export { fetchModes, fetchActiveMode, setActiveMode, fetchModeAgents, setModeAgents } from './modesApi';
