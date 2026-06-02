#pragma once
// GET /api/rag-trajectories?session_id=  — recent RAG retrieval log
// GET /api/export/rl-trajectories?session_id= — stub export bundle (MS-87 will fill)

#include "coordinator_context.h"
#include "rag_trajectory.h"
#include "httplib.h"
#include "json.hpp"

inline void register_coordinator_routes_rag_trajectory(httplib::Server& svr,
                                                        CoordinatorState& /*st*/) {
    svr.Get("/api/rag-trajectories",
            [](const httplib::Request& req, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        const std::string sid = req.has_param("session_id")
            ? req.get_param_value("session_id") : "";
        res.set_content(rag_trajectory::snapshot(sid).dump(), "application/json");
    });

    // Export stub — returns documented empty bundle; full implementation in MS-87
    svr.Get("/api/export/rl-trajectories",
            [](const httplib::Request& req, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        const std::string sid = req.has_param("session_id")
            ? req.get_param_value("session_id") : "";
        nlohmann::json bundle = {
            {"version",      "1.0"},
            {"session_id",   sid},
            {"trajectories", rag_trajectory::snapshot(sid)},
            {"contracts",    nlohmann::json::array()},
            {"note",         "Full RL trajectory export implemented in MS-87"},
        };
        res.set_content(bundle.dump(2), "application/json");
    });
}
