#include "coordinator_routes_includes.h"
#include "coordinator_routes_internal.h"

void register_coordinator_routes_dispatch(httplib::Server& svr, CoordinatorState& st) {
    // 5. Swarm dispatch — delegate to active mode
    svr.Post("/api/architect", [&st](const httplib::Request& req, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        std::cout << "\n🚀 [Swarm Matrix] Incoming broadcast" << std::endl;
        if (req.body.empty()) {
            res.status = 400;
            res.set_content("{\"error\":\"empty body\"}", "application/json");
            return;
        }
        try {
            auto j_body = json::parse(req.body);
            std::string user_prompt = j_body.value("prompt", "");
            double temperature = j_body.value("temperature", 0.7);
            std::cout << "📝 Prompt: " << user_prompt << std::endl;

            const std::string mode_name = modes::active();
            const Mode* mode = modes::get(mode_name);
            if (!mode) {
                res.status = 500;
                res.set_content(json({{"error", "no active mode registered"}}).dump(),
                                "application/json");
                return;
            }

            json cfg_for_mode;
            {
                std::lock_guard<std::mutex> lock(st.modes_config_mutex);
                cfg_for_mode = st.modes_config.contains(mode_name)
                    ? st.modes_config[mode_name] : json::object();
            }
            std::vector<Agent> mode_agents = filter_agents_for_mode(st, mode_name);
            // Circuit breaker: drop st.agents whose health breaker is open.
            std::vector<std::string> excluded_unhealthy;
            mode_agents.erase(std::remove_if(mode_agents.begin(), mode_agents.end(),
                [&](const Agent& a) {
                    if (agent_health::is_open(a.name)) {
                        excluded_unhealthy.push_back(a.name);
                        return true;
                    }
                    return false;
                }), mode_agents.end());
            ModeContext ctx{mode_agents, user_prompt, temperature, cfg_for_mode};

            if (!excluded_unhealthy.empty()) {
                std::cerr << "🔴 [dispatch] excluding " << excluded_unhealthy.size()
                          << " agent(s) with open breaker:";
                for (const auto& n : excluded_unhealthy) std::cerr << ' ' << n;
                std::cerr << std::endl;
            }
            agent_metrics::reset();
            auto dispatch_t0 = std::chrono::steady_clock::now();
            json envelope;
            try { envelope = mode->run(ctx); }
            catch (const std::exception& e) {
                std::cerr << "❌ [mode:" << mode_name << "] " << e.what() << std::endl;
                res.status = 500;
                res.set_content(json({{"error", e.what()}, {"mode", mode_name}}).dump(),
                                "application/json");
                return;
            }

            auto now = std::chrono::system_clock::now();
            auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(
                now.time_since_epoch()).count();

            if (!excluded_unhealthy.empty()) {
                if (!envelope.contains("meta") || !envelope["meta"].is_object()) {
                    envelope["meta"] = json::object();
                }
                envelope["meta"]["excluded_unhealthy"] = excluded_unhealthy;
            }
            // Per-agent timings + grand total wall clock for the whole run.
            {
                auto dispatch_t1 = std::chrono::steady_clock::now();
                double total_ms = std::chrono::duration<double, std::milli>(
                    dispatch_t1 - dispatch_t0).count();
                if (!envelope.contains("meta") || !envelope["meta"].is_object()) {
                    envelope["meta"] = json::object();
                }
                envelope["meta"]["timings"] = agent_metrics::snapshot();
                envelope["meta"]["wall_ms"] = total_ms;
            }

            // History entry preserves the legacy flat shape (agent_name → text +
            // prompt/temperature/timestamp) so existing UI st.history handling is
            // unaffected. The envelope's st.agents map is unwrapped into the entry.
            json entry = envelope.value("agents", json::object());
            entry["prompt"] = user_prompt;
            entry["temperature"] = temperature;
            entry["timestamp"] = ms;
            if (!envelope.value("final", json()).is_null()) {
                entry["_final"] = envelope["final"];
            }
            if (envelope.contains("mode")) entry["_mode"] = envelope["mode"];

            {
                std::lock_guard<std::mutex> lock(st.history_mutex);
                st.history.push_back(entry);
                coordinator_save_history(st);
            }

            res.set_content(envelope.dump(), "application/json");
            std::cout << "✅ [Swarm Matrix] Response sent (mode=" << mode_name << ")" << std::endl;

        } catch (const std::exception& e) {
            std::cerr << "❌ [Swarm Matrix] Error: " << e.what() << std::endl;
            res.status = 400;
            res.set_content("{\"error\":\"Invalid JSON or logic error\"}", "application/json");
        }
    });
}
