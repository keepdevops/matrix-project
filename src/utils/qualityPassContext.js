/**
 * Context policy for QUALITY PASS follow-up (session continuation).
 * Keeps budgets slightly higher for modes where prior context can be larger.
 */
export function qualityPassContextPolicy(activeMode) {
  const common = {
    include: ['original_prompt', 'final', 'programmer', 'tester', 'reviewer'],
    target_agent: 'programmer',
  };
  if (activeMode === 'cascade' || activeMode === 'router') {
    return {
      ...common,
      max_context_chars: 34000,
    };
  }
  if (activeMode === 'flat') {
    return {
      ...common,
      max_context_chars: 32000,
    };
  }
  return {
    ...common,
    max_context_chars: 30000,
  };
}
