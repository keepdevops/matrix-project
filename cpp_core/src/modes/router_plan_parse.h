#pragma once

#include "../agent.h"
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

// Parsed token directive from a SET_TOKENS: line emitted by the foreman.
// Only fields present in the line are applied (negative = not set).
struct TokenDirective {
    std::string agent;
    int max_tokens       = -1;
    int read_timeout_secs = -1;
};

// Extract zero or more SET_TOKENS directives from classifier output.
// Format: SET_TOKENS: <agent> max_tokens=<n> [read_timeout_secs=<n>]
// Applied in-memory only — does not persist to disk.
std::vector<TokenDirective> parse_set_tokens_directives(const std::string& raw);

// Apply parsed directives to a mutable agent vector. Returns number applied.
int apply_token_directives(std::vector<Agent>& agents,
                           const std::vector<TokenDirective>& directives);

}  // namespace router_plan
