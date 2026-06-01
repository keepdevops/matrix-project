#include "coordinator_routes_includes.h"
#include "coordinator_routes_internal.h"
#include "coordinator_routes_dispatch_prepare.h"
#include "coordinator_routes_dispatch_meta.h"
#include "coordinator_routes_dispatch_history.h"
#include "session_context.h"
#include "token_ledger.h"
#include <algorithm>
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

            // Set thread-local session for token ledger recording in call_agent
            session_context::set(dreq.session_id);

            dreq.effective_prompt = dreq.prompt;
            if (dreq.followup) {
                std::lock_guard<std::mutex> lock(st.sessions_mutex);
                SessionContinuation cont = session_build_continuation(
                    st.sessions, dreq.session_id, dreq.prompt, dreq.context_policy);
                dreq.effective_prompt = cont.prompt;
                dreq.compaction       = cont.compaction;
            }

            RagResult rag = dispatch_build_rag(dreq, st);
            dreq.effective_prompt = rag.effective_prompt;

            std::cout << "📝 Prompt: " << dreq.prompt
                      << (dreq.followup ? " (follow-up)" : "") << std::endl;

            const std::string mode_name = modes::active();
            const Mode* mode = modes::get(mode_name);
            if (!mode) {
                session_context::clear();
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

            // Token budget: mode override > global; set if not already budgeted this session
            int effective_budget = st.global_token_budget;
            if (cfg_for_mode.contains("token_budget") && cfg_for_mode["token_budget"].is_number_integer())
                effective_budget = cfg_for_mode["token_budget"].get<int>();
            if (effective_budget > 0)
                token_ledger::set_budget(dreq.session_id, effective_budget);

            // Adaptive max_select: shrink under KV pressure or budget overrun
            auto ledger = token_ledger::get(dreq.session_id);
            int base_max_select = cfg_for_mode.value("max_select", 5);
            int effective_max_select = base_max_select;
            if (dreq.kv_pressure > 0.85 || ledger.overrun())
                effective_max_select = std::max(1, base_max_select - 2);
            else if (dreq.kv_pressure > 0.70)
                effective_max_select = std::max(1, base_max_select - 1);
            if (effective_max_select != base_max_select) {
                std::cout << "🎛️  [dispatch] adaptive max_select: " << base_max_select
                          << " → " << effective_max_select
                          << " (kv=" << (int)(dreq.kv_pressure * 100) << "%"
                          << (ledger.overrun() ? " overrun" : "") << ")" << std::endl;
            }
            cfg_for_mode["max_select"] = effective_max_select;

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
                            ledger.remaining(), dreq.kv_pressure,
                            rag.rag_block, dreq.rag_agents};

            agent_metrics::reset();
            auto dispatch_t0 = std::chrono::steady_clock::now();
            json envelope;
            try { envelope = mode->run(ctx); }
            catch (const std::exception& e) {
                session_context::clear();
                std::cerr << "❌ [mode:" << mode_name << "] " << e.what() << std::endl;
                res.status = 500;
                res.set_content(json({{"error", e.what()}, {"mode", mode_name}}).dump(),
                                "application/json");
                return;
            }

            auto now = std::chrono::system_clock::now();
            auto ms  = std::chrono::duration_cast<std::chrono::milliseconds>(
                now.time_since_epoch()).count();

            dispatch_meta::stamp_envelope(envelope, dreq, rag, excluded_unhealthy,
                                          qp_target, dispatch_t0, effective_max_select);

            dispatch_write_history(st, envelope, dreq.prompt, dreq.temperature, ms,
                                   dreq.session_id, dreq.run_id, dreq.parent_run_id,
                                   dreq.effective_prompt, dreq.followup,
                                   dreq.quality_pass, mode_name, dreq.compaction);

            session_context::clear();
            res.set_content(envelope.dump(), "application/json");
            std::cout << "✅ [Swarm Matrix] Response sent (mode=" << mode_name << ")" << std::endl;

        } catch (const std::exception& e) {
            session_context::clear();
            std::cerr << "❌ [Swarm Matrix] Error: " << e.what() << std::endl;
            res.status = 400;
            res.set_content("{\"error\":\"Invalid JSON or logic error\"}", "application/json");
        }
    });
}
