#include "coordinator_routes_includes.h"
#include "coordinator_routes_internal.h"
#include "coordinator_dispatch_rag.h"
#include "code_fence_normalize.h"
#include "session_store.h"
#include <unordered_set>

void register_coordinator_routes_dispatch(httplib::Server& svr, CoordinatorState& st) {
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
            const bool followup = j_body.value("followup", false);
            const bool quality_pass = j_body.value("quality_pass", false);
            std::string session_id = j_body.value("session_id", std::string(""));
            const std::string parent_run_id = j_body.value("parent_run_id", std::string(""));
            json context_policy = j_body.value("context_policy", json::object());
            if (session_id.empty()) session_id = session_new_id("sess");
            const std::string run_id = session_new_id("run");

            std::string effective_prompt = user_prompt;
            json compaction = json::object();
            if (followup) {
                std::lock_guard<std::mutex> lock(st.sessions_mutex);
                SessionContinuation cont = session_build_continuation(
                    st.sessions, session_id, user_prompt, context_policy);
                effective_prompt = cont.prompt;
                compaction = cont.compaction;
            }

            auto rag_prep = prepare_rag_for_dispatch(
                j_body, user_prompt, effective_prompt, st.startup_config);
            effective_prompt = std::move(rag_prep.effective_prompt);
            const json rag_meta = std::move(rag_prep.rag_meta);
            const std::string& rag_block_for_ctx = rag_prep.rag_block_for_ctx;
            std::unordered_set<std::string> rag_agents_set;
            if (j_body.contains("rag_agents") && j_body["rag_agents"].is_array()) {
                for (const auto& a : j_body["rag_agents"]) {
                    if (a.is_string()) rag_agents_set.insert(a.get<std::string>());
                }
            }

            std::cout << "📝 Prompt: " << user_prompt
                      << (followup ? " (follow-up)" : "") << std::endl;

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
            std::vector<std::string> excluded_unhealthy;
            mode_agents.erase(std::remove_if(mode_agents.begin(), mode_agents.end(),
                [&](const Agent& a) {
                    if (agent_health::is_open(a.name)) {
                        excluded_unhealthy.push_back(a.name);
                        return true;
                    }
                    return false;
                }), mode_agents.end());
            const std::string qp_target = context_policy.value("target_agent", std::string("programmer"));
            ModeContext ctx{mode_agents, effective_prompt, temperature, cfg_for_mode, quality_pass, qp_target, rag_block_for_ctx, rag_agents_set};

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
            if (!envelope.contains("meta") || !envelope["meta"].is_object()) {
                envelope["meta"] = json::object();
            }
            envelope["meta"]["session_id"] = session_id;
            envelope["meta"]["run_id"] = run_id;
            envelope["meta"]["followup"] = followup;
            if (!rag_meta.empty()) envelope["meta"]["rag"] = rag_meta;
            if (quality_pass) {
                envelope["meta"]["quality_pass"] = {
                    {"used", true},
                    {"target", qp_target}
                };
            }
            if (!parent_run_id.empty()) envelope["meta"]["parent_run_id"] = parent_run_id;
            if (followup) envelope["meta"]["compaction"] = compaction;
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

            json entry = envelope.value("agents", json::object());
            entry["prompt"] = user_prompt;
            entry["temperature"] = temperature;
            entry["timestamp"] = ms;
            if (!envelope.value("final", json()).is_null()) {
                entry["_final"] = envelope["final"];
            }
            if (envelope.contains("mode")) entry["_mode"] = envelope["mode"];
            entry["_session_id"] = session_id;
            entry["_run_id"] = run_id;
            code_fence::normalize_agents_in_entry(entry);

            {
                std::lock_guard<std::mutex> lock(st.history_mutex);
                st.history.push_back(entry);
                coordinator_save_history(st);
            }
            {
                std::lock_guard<std::mutex> lock(st.sessions_mutex);
                json run = {
                    {"run_id", run_id},
                    {"parent_run_id", parent_run_id},
                    {"prompt", user_prompt},
                    {"effective_prompt", effective_prompt},
                    {"followup", followup},
                    {"quality_pass", quality_pass},
                    {"mode", mode_name},
                    {"agents", [&]() {
                        json agents = envelope.value("agents", json::object());
                        code_fence::normalize_agents_in_entry(agents);
                        return agents;
                    }()},
                    {"final", envelope.value("final", json(nullptr))},
                    {"timestamp", ms}
                };
                if (followup) run["compaction"] = compaction;
                session_append_run(st.sessions, session_id, run);
                coordinator_save_sessions(st);
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
