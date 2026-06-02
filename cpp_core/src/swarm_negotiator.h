#pragma once
// Multi-swarm token allocation negotiation.
// When MATRIX_SWARM_CONFIG_SERVICE is set, coordinators negotiate
// per-agent budgets with the config service rather than using local limits alone.

#include "httplib.h"
#include "json.hpp"
#include <iostream>
#include <string>

namespace swarm_negotiator {

struct NegotiationRequest {
    std::string swarm_id;
    std::string agent_name;
    int         requested_tokens = 0;
    int         priority         = 3; // 1=low … 5=high
};

struct NegotiationResult {
    int         granted_tokens = 0;
    bool        approved       = false;
    std::string reason;
};

/// POST to config_service_url/api/negotiate.
/// Falls back to local budget (requested_tokens) when service is unavailable.
inline NegotiationResult negotiate(const NegotiationRequest& req,
                                    const std::string& config_service_url) {
    NegotiationResult res;
    if (config_service_url.empty()) {
        res.granted_tokens = req.requested_tokens;
        res.approved       = true;
        res.reason         = "local fallback";
        return res;
    }

    try {
        // Parse host:port from url
        std::string host;
        int port = 80;
        std::string url = config_service_url;
        if (url.rfind("http://", 0) == 0) url = url.substr(7);
        auto colon = url.rfind(':');
        if (colon != std::string::npos) {
            host = url.substr(0, colon);
            port = std::stoi(url.substr(colon + 1));
        } else {
            host = url;
        }

        httplib::Client cli(host, port);
        cli.set_connection_timeout(2);
        cli.set_read_timeout(5);

        nlohmann::json body = {
            {"swarm_id",         req.swarm_id},
            {"agent_name",       req.agent_name},
            {"requested_tokens", req.requested_tokens},
            {"priority",         req.priority},
        };

        auto r = cli.Post("/api/negotiate", body.dump(), "application/json");
        if (r && r->status == 200) {
            auto j = nlohmann::json::parse(r->body);
            res.granted_tokens = j.value("granted", req.requested_tokens);
            res.approved       = j.value("approved", true);
            res.reason         = j.value("reason", "");
            return res;
        }
    } catch (const std::exception& e) {
        std::cerr << "⚠️  [swarm_negotiator] config service unreachable: "
                  << e.what() << " — using local budget" << std::endl;
    }

    // Fallback
    res.granted_tokens = req.requested_tokens;
    res.approved       = true;
    res.reason         = "config service unavailable; local fallback";
    return res;
}

} // namespace swarm_negotiator
