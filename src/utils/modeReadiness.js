/**
 * Derives human-readable warnings for a mode given its config and the set of
 * currently deployed agent names. Pure function — no I/O, fully testable.
 *
 * modeConfig: result of fetchModeAgents(activeMode)
 *   { synthesizer?: string, agents: string[], available: string[] }
 * liveAgentNames: iterable of deployed agent name strings
 *
 * Returns { ok: boolean, warnings: string[] }
 */
export function computeModeReadiness(activeMode, modeConfig, liveAgentNames) {
  const warnings = [];
  if (!activeMode || !modeConfig) return { ok: true, warnings };

  const live = new Set(liveAgentNames || []);
  const { synthesizer, agents = [] } = modeConfig;

  // Synthesizer required for cascade/pipeline to produce a final answer
  if ((activeMode === 'cascade' || activeMode === 'pipeline') && synthesizer) {
    if (!live.has(synthesizer)) {
      warnings.push(
        `synthesizer "${synthesizer}" not deployed — ${activeMode} will not produce a final answer`
      );
    }
  }

  // Mode has a configured roster — check for missing agents
  if (agents.length > 0) {
    const missing = agents.filter(a => !live.has(a));
    if (missing.length === agents.length) {
      warnings.push(`all configured agents for ${activeMode} are offline`);
    } else if (missing.length > 0) {
      warnings.push(
        `${missing.length} of ${agents.length} configured agents offline: ${missing.join(', ')}`
      );
    }
  }

  return { ok: warnings.length === 0, warnings };
}
