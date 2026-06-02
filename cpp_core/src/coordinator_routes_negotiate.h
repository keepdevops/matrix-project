#pragma once
// POST /api/negotiate — coordinator acting as negotiation server.
// Grants min(requested, global_budget * 0.75 / active_swarms).

#include "coordinator_context.h"
#include "httplib.h"
#include "json.hpp"
#include <algorithm>
#include <mutex>
#include <set>
#include <string>

namespace negotiate_server {
inline std::set<std::string>& active_swarms() {
    static std::set<std::string> s;
    return s;
}
inline std::mutex& mu() { static std::mutex m; return m; }
} // namespace negotiate_server

inline void register_coordinator_routes_negotiate(httplib::Server& svr,
                                                   CoordinatorState& st) {
    svr.Post("/api/negotiate", [&st](const httplib::Request& req,
                                     httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        nlohmann::json body;
        try { body = nlohmann::json::parse(req.body); }
        catch (...) {
            res.status = 400;
            res.set_content("{\"error\":\"invalid JSON\"}", "application/json");
            return;
        }

        const std::string swarm_id  = body.value("swarm_id", "");
        const std::string agent     = body.value("agent_name", "");
        int requested               = body.value("requested_tokens", 0);

        // Track active swarms
        {
            std::lock_guard<std::mutex> lk(negotiate_server::mu());
            if (!swarm_id.empty()) negotiate_server::active_swarms().insert(swarm_id);
        }

        int global = st.global_token_budget();
        int granted = requested; // default: unlimited
        std::string reason = "unlimited";

        if (global > 0) {
            int n_swarms = std::max(1, (int)negotiate_server::active_swarms().size());
            int per_swarm = static_cast<int>(global * 0.75 / n_swarms);
            granted = std::min(requested, per_swarm);
            reason  = "capped at 75% of global / " + std::to_string(n_swarms) + " swarms";
        }

        res.set_content(nlohmann::json({
            {"granted",  granted},
            {"approved", true},
            {"reason",   reason},
            {"swarm_id", swarm_id},
            {"agent",    agent},
        }).dump(), "application/json");
    });

    // GET /api/negotiate/swarms — list active swarm IDs
    svr.Get("/api/negotiate/swarms", [](const httplib::Request&,
                                        httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        std::lock_guard<std::mutex> lk(negotiate_server::mu());
        auto arr = nlohmann::json::array();
        for (const auto& s : negotiate_server::active_swarms()) arr.push_back(s);
        res.set_content(arr.dump(), "application/json");
    });
}
