#include "coordinator_routes_includes.h"
#include "coordinator_routes_internal.h"
#include "coordinator_routes_dispatch_prepare.h"
#include <unordered_set>

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
            DispatchRequest dreq = dispatch_parse_request(j_body);

            // Apply follow-up context compaction if needed.
            dreq.effective_prompt = dreq.prompt;
            if (dreq.followup) {
                std::lock_guard<std::mutex> lock(st.sessions_mutex);
                SessionContinuation cont = session_build_continuation(
                    st.sessions, dreq.session_id, dreq.prompt, dreq.context_policy);
                dreq.effective_prompt = cont.prompt;
                dreq.compaction       = cont.compaction;
            }

            // RAG retrieval — degrades gracefully on failure.
            RagResult rag = dispatch_build_rag(dreq, st);
            dreq.effective_prompt = rag.effective_prompt;

            std::cout << "📝 Prompt: " << dreq.prompt
                      << (dreq.followup ? " (follow-up)" : "") << std::endl;

            // Mode resolution.
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

            // Agent filtering + circuit breaker.
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
            if (!excluded_unhealthy.empty()) {
                std::cerr << "🔴 [dispatch] excluding " << excluded_unhealthy.size()
                          << " agent(s) with open breaker:";
                for (const auto& n : excluded_unhealthy) std::cerr << ' ' << n;
                std::cerr << std::endl;
            }

            const std::string qp_target = dreq.context_policy.value("target_agent", std::string("programmer"));
            ModeContext ctx{mode_agents, dreq.effective_prompt, dreq.temperature,
                            cfg_for_mode, dreq.quality_pass, qp_target,
                            rag.rag_block, dreq.rag_agents};

            // Dispatch.
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

            // Assemble metadata on the envelope.
            auto now = std::chrono::system_clock::now();
            auto ms  = std::chrono::duration_cast<std::chrono::milliseconds>(
                now.time_since_epoch()).count();

            if (!envelope.contains("meta") || !envelope["meta"].is_object())
                envelope["meta"] = json::object();
            if (!excluded_unhealthy.empty())
                envelope["meta"]["excluded_unhealthy"] = excluded_unhealthy;
            envelope["meta"]["session_id"]   = dreq.session_id;
            envelope["meta"]["run_id"]       = dreq.run_id;
            envelope["meta"]["followup"]     = dreq.followup;
            if (!rag.rag_meta.empty())       envelope["meta"]["rag"] = rag.rag_meta;
            if (dreq.quality_pass)
                envelope["meta"]["quality_pass"] = {{"used", true}, {"target", qp_target}};
            if (!dreq.parent_run_id.empty()) envelope["meta"]["parent_run_id"] = dreq.parent_run_id;
            if (dreq.followup)               envelope["meta"]["compaction"]     = dreq.compaction;
            {
                auto dispatch_t1 = std::chrono::steady_clock::now();
                double total_ms = std::chrono::duration<double, std::milli>(
                    dispatch_t1 - dispatch_t0).count();
                envelope["meta"]["timings"]  = agent_metrics::snapshot();
                envelope["meta"]["wall_ms"]  = total_ms;
            }

            dispatch_write_history(st, envelope, dreq.prompt, dreq.temperature, ms,
                                   dreq.session_id, dreq.run_id, dreq.parent_run_id,
                                   dreq.effective_prompt, dreq.followup,
                                   dreq.quality_pass, mode_name, dreq.compaction);

            res.set_content(envelope.dump(), "application/json");
            std::cout << "✅ [Swarm Matrix] Response sent (mode=" << mode_name << ")" << std::endl;

        } catch (const std::exception& e) {
            std::cerr << "❌ [Swarm Matrix] Error: " << e.what() << std::endl;
            res.status = 400;
            res.set_content("{\"error\":\"Invalid JSON or logic error\"}", "application/json");
        }
    });
}
