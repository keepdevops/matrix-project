#include "coordinator_routes_cache.h"
#include "response_cache.h"

#include <iostream>

namespace {

nlohmann::json cache_stats_json() {
    auto s = response_cache::stats();
    return nlohmann::json{
        {"enabled", s.enabled},
        {"size", s.size},
        {"max_entries", s.max_entries},
        {"ttl_secs", s.ttl_secs},
        {"hits", s.hits},
        {"misses", s.misses},
        {"inserts", s.inserts},
        {"evictions", s.evictions},
    };
}

}  // namespace

void apply_startup_response_cache_config(const nlohmann::json& startup_config) {
    if (!startup_config.contains("coordinator")
        || !startup_config["coordinator"].contains("cache")) {
        return;
    }
    const auto& c = startup_config["coordinator"]["cache"];
    int ttl = c.value("ttl_secs", 0);
    int max_entries = c.value("max_entries", 0);
    if (ttl > 0 || max_entries > 0) {
        response_cache::configure(ttl, (size_t)std::max(0, max_entries));
    }
    if (c.value("enabled", false)) {
        response_cache::set_enabled(true);
        std::cout << "💾 response cache enabled (ttl="
                  << response_cache::stats().ttl_secs << "s, max="
                  << response_cache::stats().max_entries << ")" << std::endl;
    }
}

void register_coordinator_routes_cache(httplib::Server& svr, CoordinatorState& /*st*/) {
    svr.Get("/api/cache", [](const httplib::Request&, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        res.set_content(cache_stats_json().dump(), "application/json");
    });
    svr.Post("/api/cache/config", [](const httplib::Request& req, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        try {
            auto j = nlohmann::json::parse(req.body);
            if (j.contains("enabled") && j["enabled"].is_boolean()) {
                response_cache::set_enabled(j["enabled"].get<bool>());
            }
            int ttl = j.value("ttl_secs", 0);
            int max_entries = j.value("max_entries", 0);
            if (ttl > 0 || max_entries > 0) {
                response_cache::configure(ttl, (size_t)std::max(0, max_entries));
            }
        } catch (const std::exception& e) {
            res.status = 400;
            res.set_content(nlohmann::json({{"error", e.what()}}).dump(), "application/json");
            return;
        }
        res.set_content(cache_stats_json().dump(), "application/json");
    });
    svr.Post("/api/cache/clear", [](const httplib::Request&, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        response_cache::clear();
        res.set_content(cache_stats_json().dump(), "application/json");
    });
}
