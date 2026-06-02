#pragma once
// Swarm Supervisor — rule-based inter-round policy engine.
// Analyses contract state, importance, and KV pressure to prune/deprioritize
// agents before dispatch. No model required — deterministic rule evaluation.

#include "agent.h"
#include "agent_contract.h"
#include "json.hpp"
#include <algorithm>
#include <chrono>
#include <iostream>
#include <string>
#include <vector>

namespace swarm_supervisor {

struct PolicyDecision {
    std::string agent_name;
    std::string action;     // "prune" | "deprioritize" | "hint" | "ok"
    std::string reason;
    double      confidence = 0.0; // 0–1
};

struct SupervisorResult {
    std::vector<PolicyDecision> decisions;
    bool                        any_intervention = false;
    nlohmann::json              audit_entry;
};

/// Evaluate policy rules for each agent.
/// recent_trajectories: last N rl_traj::Trajectory JSON entries.
inline SupervisorResult analyse(
    const std::vector<Agent>&   agents,
    const ContractLedger&       ledger,
    double                      kv_pressure,
    const nlohmann::json&       recent_trajectories,
    bool                        enabled = true)
{
    SupervisorResult result;
    if (!enabled) return result;

    // Build importance + overrun map from trajectories + contracts
    std::map<std::string, double> imp_map;
    if (recent_trajectories.is_array() && !recent_trajectories.empty()) {
        const auto& last = recent_trajectories[0]; // newest first
        if (last.contains("importance_scores") && last["importance_scores"].is_object())
            for (const auto& [k, v] : last["importance_scores"].items())
                if (v.is_number()) imp_map[k] = v.get<double>();
    }

    for (const auto& a : agents) {
        PolicyDecision d;
        d.agent_name = a.name;

        bool overrun = false;
        {
            std::lock_guard<std::mutex> lk(const_cast<std::mutex&>(ledger.mu));
            auto it = ledger.contracts.find(a.name);
            if (it != ledger.contracts.end()) overrun = it->second.overrun();
        }

        double imp = imp_map.count(a.name) ? imp_map.at(a.name) : 0.5;

        if (overrun && imp < 0.3) {
            d.action     = "prune";
            d.reason     = "contract overrun + low importance (" + std::to_string(imp).substr(0,4) + ")";
            d.confidence = 0.9;
            result.any_intervention = true;
        } else if (imp < 0.4 && kv_pressure > 0.7) {
            d.action     = "deprioritize";
            d.reason     = "low importance + high KV pressure";
            d.confidence = 0.7;
            result.any_intervention = true;
        } else {
            d.action     = "ok";
            d.confidence = 1.0;
        }

        result.decisions.push_back(d);
    }

    long long now_ms = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::system_clock::now().time_since_epoch()).count();

    auto dec_arr = nlohmann::json::array();
    for (const auto& d : result.decisions) {
        dec_arr.push_back({{"agent", d.agent_name}, {"action", d.action},
                           {"reason", d.reason}, {"confidence", d.confidence}});
        if (d.action != "ok")
            std::cout << "🧭 [supervisor] " << d.agent_name << " → " << d.action
                      << " (" << d.reason << ")" << std::endl;
    }

    result.audit_entry = {
        {"timestamp_ms",     now_ms},
        {"any_intervention", result.any_intervention},
        {"kv_pressure",      kv_pressure},
        {"decisions",        dec_arr},
    };
    return result;
}

/// Apply decisions: prune agents, move deprioritized to end.
inline std::vector<Agent> apply(const std::vector<Agent>& agents,
                                 const SupervisorResult&   result) {
    std::vector<Agent> pruned, normal, depr;
    for (const auto& a : agents) {
        std::string action = "ok";
        for (const auto& d : result.decisions)
            if (d.agent_name == a.name) { action = d.action; break; }
        if (action == "prune")        pruned.push_back(a); // excluded
        else if (action == "deprioritize") depr.push_back(a);
        else                              normal.push_back(a);
    }
    for (const auto& a : depr) normal.push_back(a); // append at end
    return normal;
}

} // namespace swarm_supervisor
