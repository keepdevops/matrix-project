#pragma once
// POST /api/simulate — dry-run cost estimate without dispatching.

#include "coordinator_context.h"
#include "coordinator_routes_dispatch_prepare.h"
#include "coordinator_routes_internal.h"
#include "coordinator_routes_includes.h"
#include "dispatch_simulation.h"
#include "modes/mode.h"
#include "httplib.h"
#include "json.hpp"

inline void register_coordinator_routes_simulate(httplib::Server& svr,
                                                  CoordinatorState& st) {
    svr.Post("/api/simulate", [&st](const httplib::Request& req,
                                    httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        nlohmann::json body;
        try { body = nlohmann::json::parse(req.body); }
        catch (...) {
            res.status = 400;
            res.set_content("{\"error\":\"invalid JSON\"}", "application/json");
            return;
        }

        const std::string prompt    = body.value("prompt", "");
        const std::string mode_name = modes::active();
        nlohmann::json cfg;
        { std::lock_guard<std::mutex> lk(st.modes_config_mutex);
          cfg = st.modes_config.contains(mode_name)
              ? st.modes_config[mode_name] : nlohmann::json::object(); }

        int    base_max_select = cfg.value("max_select", 5);
        double kv_pressure     = body.value("kv_pressure", 0.0);

        auto agents = filter_agents_for_mode(st, mode_name);

        auto sim = dispatch_simulation::simulate(
            prompt, st.token_budget_hierarchy, st.contract_ledger,
            agents, mode_name, base_max_select, kv_pressure);

        res.set_content(nlohmann::json({
            {"mode",                mode_name},
            {"estimated_tokens",    sim.estimated_tokens},
            {"estimated_tes",       sim.estimated_tes},
            {"would_overrun",       sim.would_overrun},
            {"effective_max_select", sim.effective_max_select},
            {"agent_estimates",     sim.agent_estimates},
        }).dump(), "application/json");
    });
}
