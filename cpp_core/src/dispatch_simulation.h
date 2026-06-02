#pragma once
// Predictive simulation — estimates token cost + TES without running inference.
// Target accuracy: ±20% of actual spend.

#include "agent.h"
#include "agent_contract.h"
#include "adaptive_select.h"
#include "token_budget_hierarchy.h"
#include "json.hpp"
#include <algorithm>
#include <map>
#include <string>
#include <vector>

namespace dispatch_simulation {

struct SimResult {
    int    estimated_tokens    = 0;
    double estimated_tes       = 0.0;
    bool   would_overrun       = false;
    int    effective_max_select = 0;
    nlohmann::json agent_estimates; // { name: { allocated, expected_tokens } }
};

/// Estimate dispatch cost from request parameters + config.
/// Uses: prompt length, max_input_tokens, max_tokens, budget hierarchy.
inline SimResult simulate(
    const std::string&        prompt,
    const BudgetHierarchy&    budget,
    const ContractLedger&     ledger,
    const std::vector<Agent>& agents,
    const std::string&        mode_name,
    int                       base_max_select,
    double                    kv_pressure)
{
    SimResult r;

    // Determine which agents would be selected (up to max_select)
    adaptive_select::Factors f{base_max_select, kv_pressure,
                                ledger.any_overrun(), 0.5};
    r.effective_max_select = adaptive_select::compute(f);

    auto selected = agents;
    if ((int)selected.size() > r.effective_max_select)
        selected.resize(r.effective_max_select);

    int total_budget = resolve_budget(budget, mode_name);

    nlohmann::json estimates = nlohmann::json::object();
    int total_est = 0;
    for (const auto& a : selected) {
        // Input: min(prompt_len/4, max_input_tokens or prompt_len/4)
        int prompt_toks = static_cast<int>(prompt.size()) / 4 + 1;
        if (a.max_input_tokens > 0) prompt_toks = std::min(prompt_toks, a.max_input_tokens);
        // Output: ~30% of max_tokens as typical generation
        int out_toks = (a.max_output_tokens > 0 ? a.max_output_tokens : a.max_tokens) * 3 / 10;
        int agent_est = prompt_toks + out_toks;
        int alloc = resolve_budget(budget, mode_name, a.name);
        estimates[a.name] = {{"allocated", alloc}, {"expected_tokens", agent_est}};
        total_est += agent_est;
    }

    r.estimated_tokens = total_est;
    r.agent_estimates  = estimates;
    r.would_overrun    = (total_budget > 0 && total_est > total_budget);

    // Rough TES estimate: assume 50ms per agent, avg importance 0.5
    double est_wall_ms = static_cast<double>(selected.size()) * 50.0;
    if (est_wall_ms > 0 && total_est > 0)
        r.estimated_tes = std::min(1.0, (total_est / (est_wall_ms * 0.5)) * 0.4
                                   + 0.5 * 0.3 + 0.5 * 0.2);

    return r;
}

} // namespace dispatch_simulation
