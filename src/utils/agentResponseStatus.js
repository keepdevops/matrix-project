/**
 * Detect coordinator-injected error strings that arrive in the `response`
 * field when an agent is unreachable or errored.
 *
 * The coordinator returns plain text like:
 *   "Agent <name> (Port <port>) is not responding."
 * (see src2/agent_client.cpp and src2/agent_stream.cpp)
 *
 * Treating these as successful responses produced two bugs:
 *   - AgentResponse rendered a green COMPLETE badge for dead agents
 *   - COMPARE VARIANTS included the error bodies as candidate variants
 */
export function isErrorResponse(text) {
  if (typeof text !== 'string') return false;
  const t = text.trim();
  return /is not responding\.?$/i.test(t) || /^Error:/i.test(t);
}
