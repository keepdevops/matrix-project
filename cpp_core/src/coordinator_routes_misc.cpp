#include "coordinator_routes_includes.h"
#include "coordinator_routes_internal.h"
#include "host_memory.h"

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

    // 6b. Live host unified-memory snapshot (MS-24 phase 2).
    svr.Get("/api/memory", [](const httplib::Request&, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        res.set_content(host_memory_snapshot().dump(), "application/json");
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

    // 8. Token usage metrics per agent (accumulated since last evict/reset)
    svr.Get("/api/metrics", [&st](const httplib::Request&, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        json out = agent_metrics::snapshot();
        std::map<std::string, int> name_to_port;
        for (const auto& a : st.agents) name_to_port[a.name] = a.port;
        for (auto& [name, entry] : out.items()) {
            if (name_to_port.count(name)) entry["port"] = name_to_port[name];
        }
        res.set_content(out.dump(), "application/json");
    });

    // 9. Evict all KV slots on every llama-server + reset per-agent token counters.
    svr.Post("/api/slots/evict", [&st](const httplib::Request&, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        json prior = agent_metrics::snapshot();
        agent_metrics::reset();

        std::map<int, int> port_slots;
        for (const auto& a : st.agents) port_slots[a.port]++;

        std::vector<std::future<std::pair<int, json>>> futures;
        for (const auto& kv : port_slots) {
            int port = kv.first, slot_count = kv.second;
            futures.push_back(std::async(std::launch::async, [port, slot_count]() {
                json result;
                result["slots_attempted"] = slot_count;
                int ok = 0;
                try {
                    httplib::Client cli("127.0.0.1", port);
                    cli.set_connection_timeout(5);
                    cli.set_read_timeout(10);
                    for (int s = 0; s < slot_count; ++s) {
                        auto r = cli.Post("/slots/" + std::to_string(s) + "?action=erase",
                                         "", "application/json");
                        if (r && r->status == 200) ++ok;
                    }
                    result["slots_cleared"] = ok;
                    result["status"] = (ok == slot_count) ? "ok" : "partial";
                } catch (const std::exception& e) {
                    std::cerr << "❌ [evict] port " << port << ": " << e.what() << std::endl;
                    result["status"] = std::string("error: ") + e.what();
                    result["slots_cleared"] = ok;
                }
                return std::make_pair(port, result);
            }));
        }

        json ports_out = json::object();
        for (auto& fut : futures) {
            auto pr = fut.get();
            ports_out[std::to_string(pr.first)] = pr.second;
        }
        std::cout << "🧹 [slots/evict] KV cleared, metrics reset" << std::endl;
        res.set_content(json({
            {"status", "ok"},
            {"ports", ports_out},
            {"prior_metrics", prior}
        }).dump(), "application/json");
    });

    // 10. CORS preflight
    // Persist an orchestrate run into the shared history so it appears in
    // the conversation thread alongside streaming runs.
    // Body: { prompt, result, mode, session_id, wall_ms? }
    svr.Post("/api/history/entry", [&st](const httplib::Request& req, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        try {
            auto body = json::parse(req.body);
            std::string prompt     = body.value("prompt", "");
            std::string result     = body.value("result", "");
            std::string mode       = body.value("mode", "");
            std::string session_id = body.value("session_id", "");
            if (prompt.empty()) {
                res.status = 400;
                res.set_content("{\"error\":\"prompt required\"}", "application/json");
                return;
            }
            auto now_ms = std::chrono::duration_cast<std::chrono::milliseconds>(
                std::chrono::system_clock::now().time_since_epoch()).count();
            json entry;
            entry["prompt"]      = prompt;
            entry["temperature"] = body.value("temperature", 0.2);
            entry["timestamp"]   = now_ms;
            entry["_final"]      = result;
            entry["_mode"]       = mode;
            entry["_session_id"] = session_id;
            entry["_orchestrate"] = true;
            {
                std::lock_guard<std::mutex> lock(st.history_mutex);
                st.history.push_back(entry);
                coordinator_save_history(st);
            }
            res.set_content(json{{"ok", true}}.dump(), "application/json");
        } catch (const std::exception& e) {
            std::cerr << "[history/entry] " << e.what() << "\n";
            res.status = 500;
            res.set_content(json{{"error", e.what()}}.dump(), "application/json");
        }
    });

    svr.Options(R"(/api/.*)", [&st](const httplib::Request&, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        res.set_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
        res.set_header("Access-Control-Allow-Headers", "Content-Type");
        res.status = 204;
    });
}
