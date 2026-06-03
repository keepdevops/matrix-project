/**
 * Context policy for QUALITY PASS follow-up (session continuation).
 * Keeps budgets slightly higher for modes where prior context can be larger.
 */
// Context budgets sized for --ctx-size 2048 on M3 Max 36 GB.
// Formula: (2048 - ~200 system - ~300 response) * 4 chars/token ≈ 6200 usable chars.
export function qualityPassContextPolicy(activeMode) {
  const common = {
    include: ['original_prompt', 'final', 'programmer', 'tester', 'reviewer'],
    target_agent: 'programmer',
  };
  if (activeMode === 'cascade' || activeMode === 'router') {
    return {
      ...common,
      max_context_chars: 5500,
    };
  }
  if (activeMode === 'flat') {
    return {
      ...common,
      max_context_chars: 5000,
    };
  }
  return {
    ...common,
    max_context_chars: 4500,
  };
}
