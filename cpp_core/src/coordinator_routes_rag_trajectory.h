#pragma once
// GET /api/rag-trajectories?session_id=  — RAG retrieval log
// GET /api/export/rl-trajectories?session_id= — full JSONL bundle for distillation app

#include "coordinator_context.h"
#include "rag_trajectory.h"
#include "rl_trajectory_logger.h"
#include "httplib.h"
#include "json.hpp"
#include <sstream>
#include <string>

inline void register_coordinator_routes_rag_trajectory(httplib::Server& svr,
                                                        CoordinatorState& /*st*/) {
    svr.Get("/api/rag-trajectories",
            [](const httplib::Request& req, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        const std::string sid = req.has_param("session_id")
            ? req.get_param_value("session_id") : "";
        res.set_content(rag_trajectory::snapshot(sid).dump(), "application/json");
    });

    // Full RL trajectory export — JSONL format for distillation app
    svr.Get("/api/export/rl-trajectories",
            [](const httplib::Request& req, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        const std::string sid = req.has_param("session_id")
            ? req.get_param_value("session_id") : "";
        double min_quality = -1.0;
        if (req.has_param("min_quality")) {
            try { min_quality = std::stod(req.get_param_value("min_quality")); }
            catch (...) {}
        }

        std::string jsonl = rl_traj::export_jsonl_filtered(sid, min_quality);
        const std::string fname = "trajectories"
            + (sid.empty() ? "" : "-" + sid.substr(0, 12)) + ".jsonl";

        res.set_header("Content-Disposition", "attachment; filename=\"" + fname + "\"");
        res.set_content(jsonl, "application/x-ndjson");
    });

    // Snapshot as JSON array (for dashboard polling)
    svr.Get("/api/rl-trajectories",
            [](const httplib::Request& req, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        const std::string sid = req.has_param("session_id")
            ? req.get_param_value("session_id") : "";
        res.set_content(rl_traj::snapshot(sid).dump(), "application/json");
    });
}
