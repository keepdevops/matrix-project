#include "coordinator_routes_includes.h"
#include "coordinator_routes_internal.h"
#include "coordinator_routes_cache.h"
#include "coordinator_kv_ops.h"
#include "host_memory.h"
#include "rss_generator.h"

void register_coordinator_routes_misc(httplib::Server& svr, CoordinatorState& st) {
    svr.Post("/api/clear-cache", [&st](const httplib::Request&, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        std::cout << "\n🗑️  [Swarm Matrix] Clearing KV cache on all agents..." << std::endl;

        auto port_results = coordinator_kv_ops::clear_kv_on_ports(
            coordinator_kv_ops::agent_port_slots(st.agents));
        json results;
        for (const auto& a : st.agents) results[a.name] = port_results[a.port];

        // RSS History event (no-op unless coordinator.rss.enabled).
        rss_generator::publish(rss_generator::Category::History,
            "KV cache cleared",
            "ports=" + std::to_string(port_results.size())
            + " agents=" + std::to_string(st.agents.size()));

        res.set_content(results.dump(), "application/json");
        std::cout << "✅ [Swarm Matrix] KV cache clear complete" << std::endl;
    });

    svr.Get("/api/memory", [](const httplib::Request&, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        res.set_content(host_memory_snapshot().dump(), "application/json");
    });

    register_pressure_routes(svr, st.agents);
    register_eviction_routes(svr, st.agents);
    register_coordinator_routes_cache(svr, st);
    apply_startup_response_cache_config(st.startup_config);

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

    svr.Post("/api/slots/evict", [&st](const httplib::Request&, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        json prior = agent_metrics::snapshot();
        agent_metrics::reset();
        json ports_out = coordinator_kv_ops::evict_slots_on_ports(
            coordinator_kv_ops::agent_port_slots(st.agents));
        std::cout << "🧹 [slots/evict] KV cleared, metrics reset" << std::endl;
        res.set_content(json({
            {"status", "ok"},
            {"ports", ports_out},
            {"prior_metrics", prior}
        }).dump(), "application/json");
    });

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

    svr.Options(R"(/api/.*)", [](const httplib::Request&, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        res.set_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
        res.set_header("Access-Control-Allow-Headers", "Content-Type");
        res.status = 204;
    });
}
