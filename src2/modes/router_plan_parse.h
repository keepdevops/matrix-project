#pragma once

#include "../json.hpp"

#include <string>
#include <unordered_set>
#include <vector>

namespace router_plan {

std::vector<std::string> as_string_vec(const nlohmann::json& j);

// Sync-router path (regex SELECTED:, word tokens). Separate from SSE
// comma-based parsing in router_selected_parse.
std::vector<std::string> parse_selected_line(
    const std::string& raw,
    const std::unordered_set<std::string>& choice_set);

std::vector<std::string> extract_names_from_plan(
    const std::string& raw,
    const std::unordered_set<std::string>& choice_set);

}  // namespace router_plan
