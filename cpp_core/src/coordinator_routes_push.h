#pragma once
// POST /api/export/push — push JSONL trajectory bundle to distillation app.
// Air-gapped: target_url must be a local http://host:port endpoint.

#include "coordinator_context.h"
#include "rl_trajectory_logger.h"
#include "httplib.h"
#include "json.hpp"
#include <sstream>
#include <string>

namespace distillation_push {

/// Send JSONL to target_url via POST. Returns HTTP status code, or -1 on error.
inline int post_jsonl(const std::string& target_url,
                       const std::string& jsonl) {
    // Parse host + port from url (http://host:port)
    std::string url = target_url;
    if (url.rfind("http://", 0) == 0) url = url.substr(7);
    std::string host;
    int port = 80;
    auto colon = url.find(':');
    auto slash  = url.find('/');
    if (colon != std::string::npos && (slash == std::string::npos || colon < slash)) {
        host = url.substr(0, colon);
        std::string rest = url.substr(colon + 1);
        port = std::stoi(rest.substr(0, rest.find('/')));
    } else {
        host = (slash != std::string::npos) ? url.substr(0, slash) : url;
    }
    std::string path = (slash != std::string::npos) ? url.substr(slash) : "/";

    httplib::Client cli(host, port);
    cli.set_connection_timeout(5);
    cli.set_read_timeout(30);
    auto res = cli.Post(path, jsonl, "application/x-ndjson");
    return res ? res->status : -1;
}

} // namespace distillation_push

inline void register_coordinator_routes_push(httplib::Server& svr,
                                              CoordinatorState& st) {
    svr.Post("/api/export/push", [&st](const httplib::Request& req,
                                       httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        nlohmann::json body;
        try { body = nlohmann::json::parse(req.body); }
        catch (...) {
            res.status = 400;
            res.set_content("{\"error\":\"invalid JSON\"}", "application/json");
            return;
        }

        const std::string target_url = body.value("target_url",
            st.distillation_push_url);
        if (target_url.empty()) {
            res.status = 400;
            res.set_content("{\"error\":\"target_url required\"}", "application/json");
            return;
        }

        const std::string sid   = body.value("session_id", "");
        double min_quality      = body.value("min_quality", 0.0);

        std::string jsonl = rl_traj::export_jsonl_filtered(sid, min_quality);
        int lines = 0;
        for (char c : jsonl) if (c == '\n') ++lines;

        int status_code = distillation_push::post_jsonl(target_url, jsonl);
        bool pushed     = (status_code >= 200 && status_code < 300);

        nlohmann::json result = {
            {"pushed",      pushed},
            {"lines",       lines},
            {"target_url",  target_url},
            {"status_code", status_code},
        };
        if (!pushed) result["error"] = "target returned " + std::to_string(status_code);

        std::cout << (pushed ? "✅" : "⚠️ ") << " [push] "
                  << lines << " trajectories → " << target_url
                  << " (HTTP " << status_code << ")" << std::endl;

        res.set_content(result.dump(), "application/json");
    });
}
