#include "coordinator_routes_includes.h"
#include "coordinator_routes_internal.h"

void register_coordinator_routes_misc(httplib::Server& svr, CoordinatorState& st) {
    // 6. Clear KV cache on all llama-server slots
    svr.Post("/api/clear-cache", [&st](const httplib::Request&, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        std::cout << "\n🗑️  [Swarm Matrix] Clearing KV cache on all agents..." << std::endl;

        std::map<int, int> port_slots;
        for (const auto& a : st.agents) port_slots[a.port]++;

        std::vector<std::future<std::pair<int, std::string>>> futures;
        for (const auto& kv : port_slots) {
            int port = kv.first;
            int slot_count = kv.second;
            futures.push_back(std::async(std::launch::async, [port, slot_count]() {
                std::string result;
                try {
                    httplib::Client cli("127.0.0.1", port);
                    cli.set_connection_timeout(5);
                    cli.set_read_timeout(10);
                    bool all_ok = true;
                    for (int s = 0; s < slot_count; ++s) {
                        auto r = cli.Post("/slots/" + std::to_string(s) + "?action=erase",
                                         "", "application/json");
                        if (!r || r->status != 200) all_ok = false;
                    }
                    result = all_ok ? "cleared" : "partial";
                } catch (const std::exception& e) {
                    std::cerr << "❌ KV clear error on port " << port
                              << ": " << e.what() << std::endl;
                    result = std::string("error: ") + e.what();
                }
                return std::make_pair(port, result);
            }));
        }

        std::map<int, std::string> port_results;
        for (auto& fut : futures) {
            auto pr = fut.get();
            port_results[pr.first] = pr.second;
            std::cout << "  port " << pr.first << ": " << pr.second << std::endl;
        }
        json results;
        for (const auto& a : st.agents) results[a.name] = port_results[a.port];

        res.set_content(results.dump(), "application/json");
        std::cout << "✅ [Swarm Matrix] KV cache clear complete" << std::endl;
    });

    // 7. KV pressure aggregator (slots + props + metrics per llama-server)
    register_pressure_routes(svr, st.agents);
    // 7b. Targeted per-slot eviction for over-pressure llama-servers
    register_eviction_routes(svr, st.agents);

    // 7c. Exact-prompt response cache (off by default).
    auto cache_stats_json = []() {
        auto s = response_cache::stats();
        return json{
            {"enabled", s.enabled},
            {"size", s.size},
            {"max_entries", s.max_entries},
            {"ttl_secs", s.ttl_secs},
            {"hits", s.hits},
            {"misses", s.misses},
            {"inserts", s.inserts},
            {"evictions", s.evictions},
        };
    };
    svr.Get("/api/cache", [cache_stats_json](const httplib::Request&, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        res.set_content(cache_stats_json().dump(), "application/json");
    });
    svr.Post("/api/cache/config", [cache_stats_json](const httplib::Request& req, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        try {
            auto j = json::parse(req.body);
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
            res.set_content(json({{"error", e.what()}}).dump(), "application/json");
            return;
        }
        res.set_content(cache_stats_json().dump(), "application/json");
    });
    svr.Post("/api/cache/clear", [cache_stats_json](const httplib::Request&, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        response_cache::clear();
        res.set_content(cache_stats_json().dump(), "application/json");
    });

    // Optional: enable cache from swarm-config.json coordinator.cache block.
    if (st.startup_config.contains("coordinator") && st.startup_config["coordinator"].contains("cache")) {
        const auto& c = st.startup_config["coordinator"]["cache"];
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

    // 8. CORS preflight
    svr.Options(R"(/api/.*)", [&st](const httplib::Request&, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        res.set_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
        res.set_header("Access-Control-Allow-Headers", "Content-Type");
        res.status = 204;
    });
}
