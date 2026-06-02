#pragma once
// Hierarchical token budget: global → mode → agent.
// resolve() returns the most-specific non-zero limit for a given mode+agent.

#include "json.hpp"
#include <map>
#include <string>

struct BudgetHierarchy {
    int global = 0;                          // 0 = unlimited
    std::map<std::string, int> by_mode;      // mode name → token limit
    std::map<std::string, int> by_agent;     // agent name → token limit
};

inline BudgetHierarchy load_budget_hierarchy(const nlohmann::json& coord) {
    BudgetHierarchy h;
    if (coord.contains("token_budget")) {
        const auto& tb = coord["token_budget"];
        if (tb.is_number_integer()) {
            h.global = tb.get<int>();
        } else if (tb.is_object()) {
            h.global = tb.value("global", 0);
            if (tb.contains("mode") && tb["mode"].is_object())
                for (const auto& [k, v] : tb["mode"].items())
                    if (v.is_number_integer()) h.by_mode[k] = v.get<int>();
            if (tb.contains("agent") && tb["agent"].is_object())
                for (const auto& [k, v] : tb["agent"].items())
                    if (v.is_number_integer()) h.by_agent[k] = v.get<int>();
        }
    }
    return h;
}

/// Returns the most-specific non-zero budget. Priority: agent > mode > global.
/// Returns 0 (unlimited) if nothing is set.
inline int resolve_budget(const BudgetHierarchy& h,
                           const std::string& mode_name,
                           const std::string& agent_name = "") {
    if (!agent_name.empty()) {
        auto it = h.by_agent.find(agent_name);
        if (it != h.by_agent.end() && it->second > 0) return it->second;
    }
    if (!mode_name.empty()) {
        auto it = h.by_mode.find(mode_name);
        if (it != h.by_mode.end() && it->second > 0) return it->second;
    }
    return h.global;
}
