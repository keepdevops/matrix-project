#pragma once
// Response annotation store — thumbs up/down + optional comment per run_id.
// POST /api/annotations          { run_id, rating, comment? }
// GET  /api/annotations/:run_id
// GET  /api/annotations

#include "coordinator_context.h"
#include "rl_trajectory_logger.h"
#include "httplib.h"
#include "json.hpp"
#include <chrono>
#include <string>

inline void register_coordinator_routes_annotations(httplib::Server& svr,
                                                     CoordinatorState& st) {
    svr.Post("/api/annotations", [&st](const httplib::Request& req,
                                       httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        nlohmann::json body;
        try { body = nlohmann::json::parse(req.body); }
        catch (...) {
            res.status = 400;
            res.set_content("{\"error\":\"invalid JSON\"}", "application/json");
            return;
        }
        const std::string run_id = body.value("run_id", "");
        if (run_id.empty()) {
            res.status = 400;
            res.set_content("{\"error\":\"run_id required\"}", "application/json");
            return;
        }
        int rating = body.value("rating", 0);
        if (rating != 1 && rating != -1) {
            res.status = 400;
            res.set_content("{\"error\":\"rating must be 1 or -1\"}", "application/json");
            return;
        }
        long long now_ms = std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::system_clock::now().time_since_epoch()).count();
        nlohmann::json ann = {
            {"run_id",    run_id},
            {"rating",    rating},
            {"comment",   body.value("comment", "")},
            {"timestamp", now_ms},
        };
        { std::lock_guard<std::mutex> lk(st.annotations_mutex);
          st.annotations[run_id] = ann; }
        // Live-update trajectory quality score if this run is still in the buffer
        rl_traj::update_annotation(run_id, rating, ann.value("comment", ""));
        res.set_content(nlohmann::json({{"saved", true}, {"run_id", run_id}}).dump(),
                        "application/json");
    });

    svr.Get(R"(/api/annotations/([^/]+))",
            [&st](const httplib::Request& req, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        const std::string run_id = req.matches[1];
        std::lock_guard<std::mutex> lk(st.annotations_mutex);
        auto it = st.annotations.find(run_id);
        if (it == st.annotations.end()) {
            res.status = 404;
            res.set_content("{\"error\":\"annotation not found\"}", "application/json");
            return;
        }
        res.set_content(it->second.dump(), "application/json");
    });

    svr.Get("/api/annotations", [&st](const httplib::Request&,
                                      httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        auto arr = nlohmann::json::array();
        std::lock_guard<std::mutex> lk(st.annotations_mutex);
        for (auto it = st.annotations.rbegin(); it != st.annotations.rend(); ++it)
            arr.push_back(it->second);
        res.set_content(arr.dump(), "application/json");
    });
}
