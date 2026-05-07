#pragma once
// KV-affinity hints: track the last prompt prefix sent to each (llama) agent,
// so the router can bias selection toward agents whose llama-server KV cache
// is already warm for the incoming prompt. Pairs with cache_prompt=true on
// outbound requests.
//
// Affinity score = byte-length of the longest common prefix between the
// recorded prompt and the incoming prompt. Higher = more KV reuse expected.
//
// This is advisory only — the router still respects classifier output and
// MLX-priority rules.

#include <string>
#include <vector>

namespace kv_router {

// Record the prompt last sent to `agent_name` (system + user concatenated).
// Capped internally; safe to call from multiple threads.
void note_prefix(const std::string& agent_name, const std::string& prompt);

// Affinity score for `agent_name` against `prompt` (LCP byte length, 0 if
// no record). 0 also when the agent was never called.
size_t affinity(const std::string& agent_name, const std::string& prompt);

// Reorder `names` in-place so higher-affinity agents come first. Ties keep
// original order (stable). Names with affinity below `min_bytes` are not
// reordered relative to each other.
void rank_by_affinity(std::vector<std::string>& names,
                      const std::string& prompt,
                      size_t min_bytes = 64);

} // namespace kv_router
