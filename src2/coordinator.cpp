#include "httplib.h"
#include "json.hpp"
#include "agent.h"
#include "agent_client.h"
#include "matrix_env.h"
#include "memory_state.h"
#include "modes/mode.h"
#include "coordinator_extras.h"

#include <atomic>
#include <chrono>
#include <csignal>
#include <cstdlib>
#include <fstream>
#include <future>
#include <iostream>
#include <map>
#include <memory>
#include <string>
#include <utility>
#include <vector>

using json = nlohmann::json;

static std::vector<Agent> agents;
static std::unique_ptr<MemoryManager> g_memory;

// Per-mode config map from swarm-config.json (coordinator.modes), passed to
// each mode invocation so mode-specific options live with the mode.
static json modes_config = json::object();

// SIGINT/SIGTERM hook: stops the httplib server so listen() returns and
// destructors (including g_memory's worker join) run on the main thread.
static std::atomic<httplib::Server*> g_svr{nullptr};
static void on_signal(int) {
    if (auto* s = g_svr.load()) s->stop();
}

int main(int argc, char* argv[]) {
    std::string config_path = "swarm-config.json";
    for (int i = 1; i < argc; i++) {
        if (std::string(argv[i]) == "--config" && i + 1 < argc) {
            config_path = argv[i + 1];
            i++;
        }
    }

    std::ifstream config_file(config_path);
    if (!config_file.is_open()) {
        std::cerr << "❌ Could not open " << config_path << std::endl;
        return 1;
    }
    json config = json::parse(config_file);
    for (auto& a : config["agents"]) {
        std::string backend_val = a.contains("backend") ? a["backend"].get<std::string>() : "";
        std::string engine = a.contains("engine") ? a["engine"].get<std::string>()
                             : (backend_val == "mlx" ? "mlx"
                               : backend_val == "docker" ? "docker" : "llama");
        agents.push_back({
            a["name"].get<std::string>(),
            a["port"].get<int>(),
            a["read_timeout_secs"].get<int>(),
            a["max_tokens"].get<int>(),
            a["system_prompt"].get<std::string>(),
            backend_val,
            engine,
            resolve_model_path(a.value("model", ""),
                               std::getenv("MATRIX_MODEL_DIR") ? std::getenv("MATRIX_MODEL_DIR") : "")
        });
    }
    init_mlx_port_locks(agents);
    std::cout << "✅ Loaded " << agents.size() << " agents from " << config_path << std::endl;

    // Memory manager — stores per-session conversation history with
    // background summarization. Storage dir mirrors the legacy history.json
    // location (alongside the active config).
    {
        auto slash = config_path.rfind('/');
        std::string storage_dir = (slash == std::string::npos)
            ? std::string(".")
            : config_path.substr(0, slash);
        if (storage_dir.empty()) storage_dir = ".";
        g_memory = std::make_unique<MemoryManager>(storage_dir, agents);
        g_memory->load_existing();
        std::cout << "🧠 memory manager online (dir=" << storage_dir << ")" << std::endl;
    }

    // Resolve coordinator.default_mode; fall back to whatever mode registered first.
    if (config.contains("coordinator")) {
        const auto& coord = config["coordinator"];
        if (coord.contains("modes") && coord["modes"].is_object()) {
            modes_config = coord["modes"];
        }
        if (coord.contains("default_mode") && coord["default_mode"].is_string()) {
            const std::string desired = coord["default_mode"].get<std::string>();
            if (!modes::set_active(desired)) {
                std::cerr << "⚠️  default_mode '" << desired
                          << "' not registered; staying on '" << modes::active() << "'" << std::endl;
            }
        }
    }
    std::cout << "🧠 active mode: " << modes::active() << std::endl;

    httplib::Server svr;
    g_svr.store(&svr);
    std::signal(SIGINT, on_signal);
    std::signal(SIGTERM, on_signal);

    // 1. Health
    svr.Get("/api/health", [](const httplib::Request&, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        res.set_content("{\"status\":\"ok\",\"engine\":\"swarm-matrix\"}", "application/json");
    });

    // 2. Agent list
    svr.Get("/api/agents", [](const httplib::Request&, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        json list = json::array();
        for (const auto& a : agents) {
            json obj = {{"name", a.name}, {"port", a.port}, {"engine", a.engine}};
            if (!a.backend.empty()) obj["backend"] = a.backend;
            if (!a.model.empty())   obj["model"]   = a.model;
            list.push_back(obj);
        }
        res.set_content(list.dump(), "application/json");
    });

    // 3. History — new shape: {summary, recent, version, last_compressed,
    //    compression_pending}. Pass ?format=legacy (or ?format=array) to get
    //    the old bare-array shape so existing UI consumers keep working
    //    until they migrate.
    svr.Get("/api/history", [](const httplib::Request& req, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        const std::string sid = req.has_param("session")
            ? req.get_param_value("session") : "default";
        json full = g_memory->snapshot_json(sid);
        const std::string fmt = req.has_param("format")
            ? req.get_param_value("format") : "";
        if (fmt == "legacy" || fmt == "array") {
            res.set_content(full["recent"].dump(), "application/json");
        } else {
            res.set_content(full.dump(), "application/json");
        }
    });

    // 4. Mode registry — list all modes + active flag
    svr.Get("/api/modes", [](const httplib::Request&, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        const std::string cur = modes::active();
        json out = json::array();
        for (const auto& m : modes::list()) {
            out.push_back({
                {"name", m.name},
                {"description", m.description},
                {"active", m.name == cur}
            });
        }
        res.set_content(out.dump(), "application/json");
    });

    svr.Get("/api/modes/active", [](const httplib::Request&, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        res.set_content(json({{"mode", modes::active()}}).dump(), "application/json");
    });

    svr.Post("/api/modes/active", [](const httplib::Request& req, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        try {
            auto j = json::parse(req.body);
            std::string name = j.value("mode", "");
            if (!modes::set_active(name)) {
                json available = json::array();
                for (const auto& m : modes::list()) available.push_back(m.name);
                res.status = 404;
                res.set_content(json({
                    {"error", "unknown mode"},
                    {"requested", name},
                    {"available", available}
                }).dump(), "application/json");
                return;
            }
            std::cout << "🧠 active mode switched to: " << name << std::endl;
            res.set_content(json({{"mode", name}}).dump(), "application/json");
        } catch (const std::exception& e) {
            std::cerr << "❌ [modes/active] " << e.what() << std::endl;
            res.status = 400;
            res.set_content(json({{"error", e.what()}}).dump(), "application/json");
        }
    });

    // 5. Swarm dispatch — delegate to active mode
    svr.Post("/api/architect", [](const httplib::Request& req, httplib::Response& res) {
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
            bool refine = j_body.value("refine", false);
            std::string session = j_body.value("session", std::string{"default"});
            std::cout << "📝 Prompt: " << user_prompt
                      << (refine ? " [refine]" : "") << std::endl;

            // For a refine call, prepend prior summary + recent turns so the
            // active mode (and through it, each agent) sees the context.
            // The user's actual prompt is preserved verbatim under "[Current
            // request — refining]" so the mode router still sees it cleanly.
            std::string effective_prompt = user_prompt;
            if (refine) {
                std::string preamble = g_memory->format_context_preamble(session);
                if (!preamble.empty()) {
                    effective_prompt = preamble
                        + "[Current request — refining the above]\n"
                        + user_prompt;
                }
            }

            const std::string mode_name = modes::active();
            const Mode* mode = modes::get(mode_name);
            if (!mode) {
                res.status = 500;
                res.set_content(json({{"error", "no active mode registered"}}).dump(),
                                "application/json");
                return;
            }

            const json& cfg_for_mode = modes_config.contains(mode_name)
                ? modes_config[mode_name] : json::object();
            ModeContext ctx{agents, effective_prompt, temperature, cfg_for_mode};

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

            // History entry preserves the legacy flat shape (agent_name → text +
            // prompt/temperature/timestamp) so existing UI history handling is
            // unaffected. The envelope's agents map is unwrapped into the entry.
            json entry = envelope.value("agents", json::object());
            entry["prompt"] = user_prompt;
            entry["temperature"] = temperature;
            entry["timestamp"] = ms;
            if (!envelope.value("final", json()).is_null()) {
                entry["_final"] = envelope["final"];
            }
            if (envelope.contains("mode")) entry["_mode"] = envelope["mode"];

            // Store the user's original prompt — not the refine-augmented
            // version — so history stays a record of what the user asked.
            entry["prompt"] = user_prompt;
            if (refine) entry["_refined"] = true;
            g_memory->append_turn(session, entry);

            res.set_content(envelope.dump(), "application/json");
            std::cout << "✅ [Swarm Matrix] Response sent (mode=" << mode_name << ")" << std::endl;

        } catch (const std::exception& e) {
            std::cerr << "❌ [Swarm Matrix] Error: " << e.what() << std::endl;
            res.status = 400;
            res.set_content("{\"error\":\"Invalid JSON or logic error\"}", "application/json");
        }
    });

    // 6. Clear KV cache on all llama-server slots
    svr.Post("/api/clear-cache", [](const httplib::Request&, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        std::cout << "\n🗑️  [Swarm Matrix] Clearing KV cache on all agents..." << std::endl;

        std::map<int, int> port_slots;
        for (const auto& a : agents) port_slots[a.port]++;

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
        for (const auto& a : agents) results[a.name] = port_results[a.port];

        res.set_content(results.dump(), "application/json");
        std::cout << "✅ [Swarm Matrix] KV cache clear complete" << std::endl;
    });

    // Register extension routes (agent tokens/prompt edits, presets, rosters)
    register_extras_routes(svr, agents, config_path);

    // 7. CORS preflight
    svr.Options(R"(/api/.*)", [](const httplib::Request&, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        res.set_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
        res.set_header("Access-Control-Allow-Headers", "Content-Type");
        res.status = 204;
    });

    std::cout << "🌐 Swarm Matrix coordinator ONLINE (port 8000)" << std::endl;
    svr.listen("0.0.0.0", 8000);

    // listen() returns when on_signal() calls svr.stop(). Drop g_memory
    // before main exits so its worker joins on the main thread instead of
    // racing process teardown.
    g_svr.store(nullptr);
    g_memory.reset();
    std::cout << "👋 Swarm Matrix coordinator shut down cleanly" << std::endl;
    return 0;
}
