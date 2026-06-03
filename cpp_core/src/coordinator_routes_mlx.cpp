#ifdef MATRIX_MLX_NATIVE_COORD
#include "coordinator_routes_mlx.h"
#include "agent_client.h"
#include "agent_stream.h"
#include "mlx_inflight.h"
#include "session_store.h"
#include "json.hpp"

#include <future>
#include <mutex>
#include <string>
#include <vector>

using json = nlohmann::json;

namespace {

void cors(httplib::Response& res) {
    res.set_header("Access-Control-Allow-Origin", "*");
}

void err(httplib::Response& res, int status, const char* msg) {
    cors(res);
    res.status = status;
    res.set_content(json{{"error", msg}}.dump(), "application/json");
}

// Returns 501 with a JSON body identifying the route and the MS issue that
// will implement it.
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

}  // namespace

void register_coordinator_routes_mlx(httplib::Server& svr, CoordinatorState& st) {
    // ── POST /api/mlx/submit — flat broadcast, blocking (MS-133) ─────────────
    svr.Post("/api/mlx/submit", [&st](const httplib::Request& req,
                                      httplib::Response& res) {
        // 1. Parse body
        json body;
        try {
            body = json::parse(req.body);
            if (!body.is_object()) throw std::runtime_error("expected JSON object");
        } catch (const std::exception& e) {
            err(res, 400, "invalid JSON");
            return;
        }

        // 2. Validate prompt
        std::string prompt = trim(body.value("prompt", std::string("")));
        if (prompt.empty()) {
            err(res, 400, "'prompt' required");
            return;
        }

        // 3. Session ID — use caller's or generate a new one
        std::string session_id = trim(body.value("session_id", std::string("")));
        if (session_id.empty()) session_id = session_new_id("mlx");

        // 4. Collect MLX agents from the loaded roster
        std::vector<Agent> mlx_agents;
        for (const auto& a : st.agents) {
            if (a.engine == "mlx") mlx_agents.push_back(a);
        }
        if (mlx_agents.empty()) {
            err(res, 503, "no MLX agents configured");
            return;
        }

        // 5. Flat broadcast — parallel calls, per-port serialisation via mutex
        std::vector<std::future<std::string>> futures;
        futures.reserve(mlx_agents.size());
        for (const auto& agent : mlx_agents) {
            futures.push_back(
                std::async(std::launch::async, [agent, prompt]() {
                    std::lock_guard<std::mutex> lk(
                        mlx_coordinator::port_mutex(agent.port));
                    return call_agent(agent, prompt);
                })
            );
        }

        // 6. Collect and join responses
        std::string result;
        for (auto& fut : futures) result += fut.get();

        // 7. Respond
        cors(res);
        res.set_content(
            json{{"result", result}, {"session_id", session_id}}.dump(),
            "application/json");
    });

    // ── POST /api/mlx/stream — SSE token stream, flat broadcast (MS-136) ─────
    svr.Post("/api/mlx/stream", [&st](const httplib::Request& req,
                                      httplib::Response& res) {
        // 1. Parse + validate (same rules as /submit)
        json body;
        try {
            body = json::parse(req.body);
            if (!body.is_object()) throw std::runtime_error("expected JSON object");
        } catch (const std::exception&) {
            err(res, 400, "invalid JSON");
            return;
        }
        std::string prompt = trim(body.value("prompt", std::string("")));
        if (prompt.empty()) { err(res, 400, "'prompt' required"); return; }

        std::string session_id = trim(body.value("session_id", std::string("")));
        if (session_id.empty()) session_id = session_new_id("mlx");

        // 2. Snapshot MLX agents (by value — avoid dangling ref inside closure)
        std::vector<Agent> mlx_agents;
        for (const auto& a : st.agents)
            if (a.engine == "mlx") mlx_agents.push_back(a);

        if (mlx_agents.empty()) { err(res, 503, "no MLX agents configured"); return; }

        // 3. Set SSE headers before opening the stream
        res.set_header("X-Session-Id", session_id);
        res.set_header("Cache-Control", "no-cache");

        // 4. Stream via chunked content provider
        res.set_chunked_content_provider("text/event-stream",
            [mlx_agents, prompt, session_id](size_t, httplib::DataSink& sink) -> bool {

            std::mutex sink_mu;
            auto write_event = [&](const std::string& event,
                                   const json& data) {
                std::lock_guard<std::mutex> lk(sink_mu);
                if (!sink.is_writable()) return;
                std::string frame = "event: " + event + "\ndata: "
                                    + data.dump() + "\n\n";
                sink.write(frame.data(), frame.size());
            };

            // agent_start for all agents upfront
            for (const auto& agent : mlx_agents)
                write_event("agent_start", {{"agent_id", agent.name}});

            // Flat parallel broadcast — per-port mutex serialises MLX calls
            std::vector<std::future<std::string>> futures;
            futures.reserve(mlx_agents.size());
            for (const auto& agent : mlx_agents) {
                futures.push_back(std::async(std::launch::async,
                    [agent, prompt, &write_event]() -> std::string {
                        std::lock_guard<std::mutex> port_lk(
                            mlx_coordinator::port_mutex(agent.port));
                        return agent_stream::stream_agent(
                            agent, agent.system_prompt, prompt,
                            [&](const std::string& delta) {
                                write_event("token", {
                                    {"text",     delta},
                                    {"agent_id", agent.name},
                                });
                            });
                    }));
            }

            // Collect in launch order; emit agent_end as each completes
            for (size_t i = 0; i < futures.size(); ++i) {
                try { futures[i].get(); }
                catch (const std::exception& e) {
                    write_event("error", {
                        {"error",    e.what()},
                        {"agent_id", mlx_agents[i].name},
                    });
                }
                write_event("agent_end", {{"agent_id", mlx_agents[i].name}});
            }

            write_event("done", {{"session_id", session_id}});

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

            httplib::Client cli("127.0.0.1", agent.port);
            cli.set_connection_timeout(2);
            cli.set_read_timeout(2);
            auto r = cli.Get("/v1/models");

            const bool ok = r && r->status == 200;
            if (!ok) all_ok = false;
            const std::string detail = ok
                ? "port " + std::to_string(agent.port) + " ok"
                : "port " + std::to_string(agent.port) + " unreachable";
            backends[agent.name] = {{"ok", ok}, {"detail", detail}};
        }

        if (backends.empty()) {
            // No MLX agents configured — report healthy with empty set
            cors(res);
            res.set_content(
                json{{"ok", true}, {"backends", json::object()}}.dump(),
                "application/json");
            return;
        }

        cors(res);
        res.status = all_ok ? 200 : 503;
        res.set_content(
            json{{"ok", all_ok}, {"backends", backends}}.dump(),
            "application/json");
    });

    // ── GET /api/mlx/pressure — inflight counts + session snapshot (MS-134) ──
    svr.Get("/api/mlx/pressure", [&st](const httplib::Request&, httplib::Response& res) {
        // Build per-port inflight map from mlx_inflight telemetry
        json inflight = json::object();
        for (const auto& agent : st.agents) {
            if (agent.engine != "mlx") continue;
            const std::string port_key = std::to_string(agent.port);
            // Accumulate if multiple agents share a port
            const int count = mlx_inflight::get(agent.port);
            if (inflight.contains(port_key)) {
                inflight[port_key] = inflight[port_key].get<int>() + count;
            } else {
                inflight[port_key] = count;
            }
        }

        // Session snapshot: count + IDs currently in the store
        int session_count = 0;
        {
            std::lock_guard<std::mutex> lk(st.sessions_mutex);
            session_count = static_cast<int>(st.sessions.size());
        }

        cors(res);
        res.set_content(
            json{{"inflight", inflight}, {"sessions", session_count}}.dump(),
            "application/json");
    });

    // ── GET /api/mlx/agents — loaded agent list (MS-139) ─────────────────────
    svr.Get("/api/mlx/agents", [](const httplib::Request&, httplib::Response& res) {
        stub_501(res, "GET /api/mlx/agents", "MS-139");
    });

    // ── GET /api/mlx/modes — supported modes (MS-139) ────────────────────────
    svr.Get("/api/mlx/modes", [](const httplib::Request&, httplib::Response& res) {
        stub_501(res, "GET /api/mlx/modes", "MS-139");
    });

    // ── POST /api/mlx/modes/active — set active mode (MS-139) ────────────────
    svr.Post("/api/mlx/modes/active", [](const httplib::Request&, httplib::Response& res) {
        stub_501(res, "POST /api/mlx/modes/active", "MS-139");
    });

    // ── POST /api/mlx/session/clear — explicit session flush (MS-140) ────────
    svr.Post("/api/mlx/session/clear", [](const httplib::Request&, httplib::Response& res) {
        stub_501(res, "POST /api/mlx/session/clear", "MS-140");
    });
}

#endif  // MATRIX_MLX_NATIVE_COORD
