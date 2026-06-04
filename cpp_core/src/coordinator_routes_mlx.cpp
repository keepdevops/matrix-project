#ifdef MATRIX_MLX_NATIVE_COORD
#include "coordinator_routes_mlx.h"
#include "agent_client.h"
#include "agent_client_pool.h"
#include "agent_stream.h"
#include "coordinator_routes_architect_persist.h"
#include "mlx_inflight.h"
#include "mlx_memory_guard.h"  // MS-171: unified-memory pre-flight guard
#include "mlx_session_store.h"
#include "model_registry.h"   // MS-68 Phase 2a: unified registry (accounting + inproc)
#include "session_store.h"
#include "synthesis_budget.h"
#include "json.hpp"

#include <future>
#include <mutex>
#include <set>
#include <string>
#include <vector>

using json = nlohmann::json;

namespace {

// ── Active mode state (MS-137) ───────────────────────────────────────────────
// Protected by a mutex; read/written from concurrent request threads.
static std::string s_active_mlx_mode = "flat";
static std::mutex  s_mode_mu;

const std::set<std::string> VALID_MLX_MODES = {"flat", "pipeline", "cascade"};

std::string read_mode() {
    std::lock_guard<std::mutex> lk(s_mode_mu);
    return s_active_mlx_mode;
}
void write_mode(const std::string& m) {
    std::lock_guard<std::mutex> lk(s_mode_mu);
    s_active_mlx_mode = m;
}

// ── Response helpers ─────────────────────────────────────────────────────────
void cors(httplib::Response& res) {
    res.set_header("Access-Control-Allow-Origin", "*");
}

void err(httplib::Response& res, int status, const std::string& msg) {
    cors(res);
    res.status = status;
    res.set_content(json{{"error", msg}}.dump(), "application/json");
}

void stub_501(httplib::Response& res, const char* route, const char* ms) {
    cors(res);
    res.status = 501;
    res.set_content(
        json{{"error", "not implemented"}, {"route", route},
             {"status", "stub — " + std::string(ms)}}.dump(),
        "application/json");
}

std::string trim(std::string s) {
    const auto ws = " \t\r\n";
    s.erase(0, s.find_first_not_of(ws));
    const auto last = s.find_last_not_of(ws);
    if (last != std::string::npos) s.erase(last + 1);
    else s.clear();
    return s;
}

// MS-68 Phase 2b: resolve whether an agent runs in-process for this build.
//   "inproc" → always in-process.
//   "auto"   → in-process when the agent is MLX-eligible (this is an embed
//              build, so the lane is available); otherwise HTTP.
//   "http"/other → HTTP.
// In a non-embed build the call sites are compiled out, so everything is HTTP.
#ifdef MATRIX_MLX_INPROC
bool resolve_inproc(const Agent& agent) {
    if (agent.dispatch == "inproc") return true;
    if (agent.dispatch == "auto")
        return agent.engine == "mlx" && !agent.model.empty();
    return false;
}
#endif

// Routing decision string for observability (works in every build).
std::string dispatch_route(const Agent& agent) {
#ifdef MATRIX_MLX_INPROC
    return resolve_inproc(agent) ? "inproc" : "http";
#else
    (void)agent;
    return "http";
#endif
}

}  // namespace

void register_coordinator_routes_mlx(httplib::Server& svr, CoordinatorState& st) {
    // ── POST /api/mlx/submit — flat broadcast, blocking (MS-133) ─────────────
    svr.Post("/api/mlx/submit", [&st](const httplib::Request& req,
                                      httplib::Response& res) {
        json body;
        try {
            body = json::parse(req.body);
            if (!body.is_object()) throw std::runtime_error("expected JSON object");
        } catch (const std::exception&) { err(res, 400, "invalid JSON"); return; }

        std::string prompt = trim(body.value("prompt", std::string("")));
        if (prompt.empty()) { err(res, 400, "'prompt' required"); return; }

        std::string session_id = trim(body.value("session_id", std::string("")));
        if (session_id.empty()) session_id = session_new_id("mlx");
        const double temperature = body.value("temperature", 0.7);

        std::vector<Agent> mlx_agents;
        for (const auto& a : st.agents)
            if (a.engine == "mlx") mlx_agents.push_back(a);
        if (mlx_agents.empty()) { err(res, 503, "no MLX agents configured"); return; }

#ifdef MATRIX_MLX_INPROC
        // MS-171 Phase B: reclaim idle resident models under high pressure
        // before the hard guard rejects (auto-publishes eviction RSS events).
        if (mlx_mem_guard::pressure_exceeds(st.mlx_memory_guard_config))
            model_mem::ModelRegistry::instance().evict_idle(60);
#endif
        // MS-171: reject early if unified memory is below guard threshold.
        { const json mc = mlx_mem_guard::check(st.mlx_memory_guard_config);
          if (!mc.value("ok", true)) { err(res, 503, mc.value("error", "low memory")); return; } }

        // Track user message; evict stale sessions opportunistically
        mlx_sessions().cleanup_idle();
#ifdef MATRIX_MLX_INPROC
        // #297: reclaim resident in-process models idle past the cap (also fires
        // the model-evicted RSS event and sweeps idle prompt caches).
        model_mem::ModelRegistry::instance().evict_idle(model_mem::model_idle_secs());
#endif
        mlx_sessions().append_message(session_id, "user", prompt);

        // Flat broadcast — collect per-agent outputs for history
        std::vector<std::future<std::string>> futures;
        futures.reserve(mlx_agents.size());
        for (const auto& agent : mlx_agents) {
            futures.push_back(std::async(std::launch::async, [agent, prompt]() -> std::string {
#ifdef MATRIX_MLX_INPROC
                // MS-161/MS-68 2b: in-process dispatch (inproc or resolved auto).
                if (resolve_inproc(agent)) {
                    const int mt = agent.max_tokens > 0 ? agent.max_tokens : 512;
                    auto r = model_mem::ModelRegistry::instance().generate(agent, prompt, mt);
                    return r.ok ? r.text : ("[inproc error] " + r.error);
                }
#endif
                std::lock_guard<std::mutex> lk(mlx_coordinator::port_mutex(agent.port));
                return call_agent(agent, prompt);
            }));
        }
        std::string result;
        std::map<std::string, std::string> outputs;
        for (size_t i = 0; i < futures.size(); ++i) {
            const std::string text = futures[i].get();
            outputs[mlx_agents[i].name] = text;
            result += text;
        }
        mlx_sessions().append_message(session_id, "assistant", result);

        // MS-149: persist to global history + sessions (same path as architect routes)
        const std::string run_id = session_new_id("run");
        persist_stream_run(prompt, temperature, read_mode(), session_id, run_id, "",
                           outputs, st,
                           [](const std::string&, const std::string&) {});

        cors(res);
        res.set_content(
            json{{"result", result}, {"session_id", session_id}}.dump(),
            "application/json");
    });

    // ── POST /api/mlx/stream — SSE, mode-aware dispatch (MS-136 / MS-137) ────
    svr.Post("/api/mlx/stream", [&st](const httplib::Request& req,
                                      httplib::Response& res) {
        json body;
        try {
            body = json::parse(req.body);
            if (!body.is_object()) throw std::runtime_error("expected JSON object");
        } catch (const std::exception&) { err(res, 400, "invalid JSON"); return; }

        std::string prompt = trim(body.value("prompt", std::string("")));
        if (prompt.empty()) { err(res, 400, "'prompt' required"); return; }

        std::string session_id = trim(body.value("session_id", std::string("")));
        if (session_id.empty()) session_id = session_new_id("mlx");
        const double temperature = body.value("temperature", 0.7);
        const std::string run_id = session_new_id("run");

        std::vector<Agent> mlx_agents;
        for (const auto& a : st.agents)
            if (a.engine == "mlx") mlx_agents.push_back(a);
        if (mlx_agents.empty()) { err(res, 503, "no MLX agents configured"); return; }

#ifdef MATRIX_MLX_INPROC
        // MS-171 Phase B: reclaim idle resident models under high pressure
        // before the hard guard rejects (auto-publishes eviction RSS events).
        if (mlx_mem_guard::pressure_exceeds(st.mlx_memory_guard_config))
            model_mem::ModelRegistry::instance().evict_idle(60);
#endif
        // MS-171: reject early if unified memory is below guard threshold.
        { const json mc = mlx_mem_guard::check(st.mlx_memory_guard_config);
          if (!mc.value("ok", true)) { err(res, 503, mc.value("error", "low memory")); return; } }

        // Track user message; evict stale sessions opportunistically
        mlx_sessions().cleanup_idle();
#ifdef MATRIX_MLX_INPROC
        // #297: reclaim resident in-process models idle past the cap (also fires
        // the model-evicted RSS event and sweeps idle prompt caches).
        model_mem::ModelRegistry::instance().evict_idle(model_mem::model_idle_secs());
#endif
        mlx_sessions().append_message(session_id, "user", prompt);

        const std::string mode = read_mode();  // snapshot before entering the stream

        res.set_header("X-Session-Id", session_id);
        res.set_header("Cache-Control", "no-cache");

        res.set_chunked_content_provider("text/event-stream",
            [mlx_agents, prompt, session_id, mode, temperature, run_id, &st]
            (size_t, httplib::DataSink& sink) -> bool {

            std::mutex sink_mu;
            auto emit = [&](const std::string& event, const json& data) {
                std::lock_guard<std::mutex> lk(sink_mu);
                if (!sink.is_writable()) return;
                std::string frame = "event: " + event + "\ndata: " + data.dump() + "\n\n";
                sink.write(frame.data(), frame.size());
            };

            // Per-agent helper: agent_start → stream (tokens) → agent_end
            // Collects output per agent for history persistence (MS-149)
            std::mutex out_mu;
            std::map<std::string, std::string> outputs;

            auto run_one = [&](const Agent& agent) {
                // MS-68 2b: surface the resolved routing decision (inproc|http).
                emit("agent_start", {{"agent_id", agent.name},
                                     {"dispatch", dispatch_route(agent)}});
                std::string agent_out;
                try {
                    auto on_tok = [&](const std::string& delta) {
                        emit("token", {{"text", delta}, {"agent_id", agent.name}});
                    };
#ifdef MATRIX_MLX_INPROC
                    // MS-161 Phase C / MS-68 2b: stream in-process (inproc or auto).
                    if (resolve_inproc(agent)) {
                        const int mt = agent.max_tokens > 0 ? agent.max_tokens : 512;
                        auto sr = model_mem::ModelRegistry::instance().generate_stream(agent, prompt, mt, on_tok, session_id);
                        agent_out = sr.ok ? sr.text : ("[inproc error] " + sr.error);
                    } else
#endif
                    {
                        std::lock_guard<std::mutex> port_lk(
                            mlx_coordinator::port_mutex(agent.port));
                        agent_out = agent_stream::stream_agent(
                            agent, agent.system_prompt, prompt, on_tok, nullptr, session_id);
                    }
                } catch (const std::exception& e) {
                    emit("error", {{"error", e.what()}, {"agent_id", agent.name}});
                }
                { std::lock_guard<std::mutex> lk(out_mu); outputs[agent.name] = agent_out; }
                emit("agent_end", {{"agent_id", agent.name}});
            };

            if (mode == "pipeline") {
                for (const auto& agent : mlx_agents) run_one(agent);
            } else if (mode == "cascade" && mlx_agents.size() > 1) {
                // MS-137: cascade — parallel broadcast, then role-based synthesizer step.
                // Synthesizer: first agent tagged "synthesis*", else last in roster.
                const Agent* synth_ptr = nullptr;
                for (const auto& a : mlx_agents)
                    for (const auto& tag : a.tags)
                        if (tag.rfind("synthesis", 0) == 0) { synth_ptr = &a; break; }
                if (!synth_ptr) synth_ptr = &mlx_agents.back();
                const std::string synth_name = synth_ptr->name;
                const Agent synth_agent     = *synth_ptr;

                // Broadcast to all non-synthesizer agents in parallel
                {
                    std::vector<std::future<void>> futures;
                    for (const auto& a : mlx_agents) {
                        if (a.name == synth_name) continue;
                        const Agent ac = a;
                        futures.push_back(std::async(std::launch::async,
                            [ac, &run_one]() { run_one(ac); }));
                    }
                    for (auto& f : futures) f.get();
                }

                // Collect healthy broadcaster outputs for synthesis prompt
                std::vector<std::pair<std::string, std::string>> contributors;
                {
                    std::lock_guard<std::mutex> lk(out_mu);
                    for (const auto& a : mlx_agents) {
                        if (a.name == synth_name) continue;
                        auto it = outputs.find(a.name);
                        if (it != outputs.end() && !it->second.empty())
                            contributors.push_back({a.name, it->second});
                    }
                }

                emit("synthesis_start", {{"agent_id", synth_name}});
                emit("agent_start",     {{"agent_id", synth_name}});

                const std::string synth_prompt =
                    synthesis_budget::build_stream_synthesis_prompt(
                        prompt, contributors, &synth_agent);
                std::string synth_out;
                auto synth_on_tok = [&](const std::string& delta) {
                    emit("token", {{"text", delta}, {"agent_id", synth_name}});
                };
                try {
#ifdef MATRIX_MLX_INPROC
                    // MS-161 Phase C / MS-68 2b: synthesizer step in-process (inproc or auto).
                    if (resolve_inproc(synth_agent)) {
                        const int mt = synth_agent.max_tokens > 0 ? synth_agent.max_tokens : 512;
                        auto sr = model_mem::ModelRegistry::instance().generate_stream(
                            synth_agent, synth_prompt, mt, synth_on_tok);
                        synth_out = sr.ok ? sr.text : ("[inproc error] " + sr.error);
                    } else
#endif
                    {
                        std::lock_guard<std::mutex> port_lk(
                            mlx_coordinator::port_mutex(synth_agent.port));
                        synth_out = agent_stream::stream_agent(
                            synth_agent, synth_agent.system_prompt, synth_prompt,
                            synth_on_tok, nullptr, session_id);
                    }
                } catch (const std::exception& e) {
                    emit("error", {{"error", e.what()}, {"agent_id", synth_name}});
                }
                { std::lock_guard<std::mutex> lk(out_mu); outputs[synth_name] = synth_out; }
                emit("agent_end", {{"agent_id", synth_name}});
            } else {
                // flat, or cascade with a single agent (degrade to flat)
                std::vector<std::future<void>> futures;
                futures.reserve(mlx_agents.size());
                for (const auto& a : mlx_agents)
                    futures.push_back(std::async(std::launch::async,
                        [a, &run_one]() { run_one(a); }));
                for (auto& f : futures) f.get();
            }

            // MS-149: persist run to global history + sessions; emit session event
            persist_stream_run(prompt, temperature, mode, session_id, run_id, "",
                               outputs, st, emit);

            emit("done", {{"session_id", session_id}});
            std::lock_guard<std::mutex> lk(sink_mu);
            sink.done();
            return true;
        });
    });

    // ── GET /api/mlx/health — probe /v1/models per MLX port (MS-134) ────────
    svr.Get("/api/mlx/health", [&st](const httplib::Request&, httplib::Response& res) {
        json backends = json::object();
        bool all_ok = true;
        for (const auto& agent : st.agents) {
            if (agent.engine != "mlx") continue;
            // MS-148: use connection pool for keep-alive reuse across health checks
            auto cli_ptr = pool_checkout(agent.port, 2 /*read_timeout_secs*/);
            cli_ptr->set_connection_timeout(2);
            auto r = cli_ptr->Get("/v1/models");
            const bool ok = r && r->status == 200;
            if (ok) pool_checkin(agent.port, std::move(cli_ptr));
            if (!ok) all_ok = false;
            backends[agent.name] = {
                {"ok", ok},
                {"detail", (ok ? "port " : "port ") + std::to_string(agent.port)
                            + (ok ? " ok" : " unreachable")},
            };
        }
        cors(res);
        res.status = (backends.empty() || all_ok) ? 200 : 503;
        res.set_content(
            json{{"ok", backends.empty() || all_ok}, {"backends", backends}}.dump(),
            "application/json");
    });

    // ── GET /api/mlx/pressure — inflight counts + session count (MS-134) ─────
    svr.Get("/api/mlx/pressure", [&st](const httplib::Request&, httplib::Response& res) {
        json inflight = json::object();
        for (const auto& agent : st.agents) {
            if (agent.engine != "mlx") continue;
            const std::string k = std::to_string(agent.port);
            const int c = mlx_inflight::get(agent.port);
            inflight[k] = inflight.contains(k) ? inflight[k].get<int>() + c : c;
        }
        json out = {{"inflight", inflight}, {"sessions", mlx_sessions().snapshot()}};
        // MS-68 Phase 2a: surface the unified registry snapshot — always on (not
        // just under INPROC). Accounting-only builds report an empty set; INPROC
        // builds report resident in-process models with usage counts.
        const json reg = model_mem::ModelRegistry::instance().snapshot();
        out["resident_models"] = reg["models"];
        out["resident_count"]  = reg["resident_count"];
#ifdef MATRIX_MLX_INPROC
        // MS-68 2c′-B: surface active prompt-cache session count (atomic, no GIL).
        out["prompt_cache_sessions"] = model_mem::prompt_cache_session_count();
#endif
        // MS-171: unified memory telemetry (null on non-Apple builds).
        const json mem = mlx_mem_guard::pressure_memory_section();
        if (!mem.is_null()) out["unified_memory"] = mem;
        cors(res);
        res.set_content(out.dump(), "application/json");
    });

    // ── GET /api/mlx/agents — MLX agent roster (MS-139) ─────────────────────
    svr.Get("/api/mlx/agents", [&st](const httplib::Request&, httplib::Response& res) {
        // Return {agent_name: {port, engine, model, system_prompt}} — parity with Python
        json agents = json::object();
        for (const auto& a : st.agents) {
            if (a.engine != "mlx") continue;
            agents[a.name] = {
                {"port",          a.port},
                {"engine",        a.engine},
                {"model",         a.model},
                {"system_prompt", a.system_prompt},
                {"context",       a.context_window},
                {"max_tokens",    a.max_tokens},
            };
        }
        cors(res);
        res.set_content(agents.dump(), "application/json");
    });

    // ── GET /api/mlx/modes — supported modes + active (MS-137) ───────────────
    svr.Get("/api/mlx/modes", [](const httplib::Request&, httplib::Response& res) {
        cors(res);
        res.set_content(
            json{{"modes",  json(VALID_MLX_MODES)},
                 {"active", read_mode()}}.dump(),
            "application/json");
    });

    // ── POST /api/mlx/modes/active — set active mode (MS-137) ────────────────
    svr.Post("/api/mlx/modes/active", [](const httplib::Request& req,
                                         httplib::Response& res) {
        json body;
        try {
            body = json::parse(req.body);
            if (!body.is_object()) throw std::runtime_error("expected JSON object");
        } catch (const std::exception&) { err(res, 400, "invalid JSON"); return; }

        const std::string mode = trim(body.value("mode", std::string("")));
        if (!VALID_MLX_MODES.count(mode)) {
            err(res, 400, "unknown mode — valid: flat, pipeline, cascade");
            return;
        }
        write_mode(mode);
        cors(res);
        res.set_content(json{{"active", mode}}.dump(), "application/json");
    });

    // ── POST /api/mlx/session/clear — explicit session flush (MS-140) ────────
    svr.Post("/api/mlx/session/clear", [](const httplib::Request& req,
                                          httplib::Response& res) {
        json body;
        try {
            body = json::parse(req.body);
            if (!body.is_object()) throw std::runtime_error("expected JSON object");
        } catch (const std::exception&) { err(res, 400, "invalid JSON"); return; }

        // session_id must be a string; non-string type (e.g. integer) → 400
        if (body.contains("session_id") && !body["session_id"].is_string()
                                       && !body["session_id"].is_null()) {
            err(res, 400, "'session_id' must be a string");
            return;
        }
        const std::string session_id = trim(body.value("session_id", std::string("")));
        cors(res);
        if (!session_id.empty()) {
            const bool cleared = mlx_sessions().clear(session_id);
            res.set_content(
                json{{"cleared", cleared ? json::array({session_id})
                                         : json::array()}}.dump(),
                "application/json");
        } else {
            const int count = mlx_sessions().clear_all();
            res.set_content(json{{"cleared_count", count}}.dump(), "application/json");
        }
    });
}

#endif  // MATRIX_MLX_NATIVE_COORD
