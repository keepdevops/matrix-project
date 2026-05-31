#pragma once

#include "json.hpp"

#include <string>

namespace code_fence {

// Agents whose session/history text is reduced to fenced code when fences exist.
bool is_code_history_agent(const std::string& agent_name);

// If raw contains a complete markdown fence, return prose-stripped re-wrapped fences;
// otherwise return raw unchanged.
std::string normalize_for_history(const std::string& raw);

// Mutate string values on agent keys in a flat history/run object (skips metadata keys).
void normalize_agents_in_entry(nlohmann::json& entry);

}  // namespace code_fence
