#pragma once
// SELECTED-line parsing for streaming router path (no httplib).

#include <string>
#include <unordered_set>
#include <vector>

/// Parse "SELECTED: a, b" line from classifier raw output (no httplib).
std::vector<std::string> parse_router_selected_agents(const std::string& raw,
    int max_select,
    const std::unordered_set<std::string>& valid_names,
    const std::string& classifier_name);
