#include "httplib.h"
#include "json.hpp"
#include "agent.h"
#include "agent_client.h"
#include "agent_stream.h"
#include "modes/mode.h"
#include "pressure.h"
#include "response_cache.h"

#include <atomic>
#include <chrono>
#include <fstream>
#include <future>
#include <iostream>
#include <map>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <utility>
#include <vector>

using json = nlohmann::json;

static std::vector<Agent> agents;

static std::vector<json> history;
static std::mutex history_mutex;
static std::string history_path;

// Per-mode config map from swarm-config.json (coordinator.modes), passed to
// each mode invocation so mode-specific options live with the mode.
static json modes_config = json::object();
static std::mutex modes_config_mutex;
static std::string config_path_global;

// Filter the global agents vector to those listed in modes_config[mode]["agents"].
// Empty/missing list => return all agents (preserve config order).
// Order of returned vector matches the order of names in the configured list.
static std::vector<Agent> filter_agents_for_mode(const std::string& mode_name) {
    std::lock_guard<std::mutex> lock(modes_config_mutex);
    if (!modes_config.contains(mode_name)) return agents;
    const auto& cfg = modes_config[mode_name];
    if (!cfg.contains("agents") || !cfg["agents"].is_array() || cfg["agents"].empty()) {
        return agents;
    }
    std::map<std::string, const Agent*> by_name;
    for (const auto& a : agents) by_name[a.name] = &a;
    std::vector<Agent> filtered;
    std::set<std::string> picked;
    for (const auto& item : cfg["agents"]) {
        if (!item.is_string()) continue;
        const std::string n = item.get<std::string>();
        auto it = by_name.find(n);
        if (it != by_name.end() && picked.insert(n).second) {
            filtered.push_back(*it->second);
        }
    }
    // Ensure auxiliary agents referenced by mode config (e.g. pipeline.synthesizer)
    // are reachable inside the mode even if they're not part of the chain roster.
    // Without this, the mode's by_name lookup misses them and the feature silently
    // no-ops.
    for (const auto& key : {"synthesizer"}) {
        if (cfg.contains(key) && cfg[key].is_string()) {
            const std::string n = cfg[key].get<std::string>();
            auto it = by_name.find(n);
            if (it != by_name.end() && picked.insert(n).second) {
                filtered.push_back(*it->second);
            }
        }
    }
    return filtered.empty() ? agents : filtered;
}

// Persist current modes_config back to the active config file (the one the
// coordinator was launched with). Source swarm-config.json is NOT touched —
// the deploy flow owns that. Caller must hold modes_config_mutex.
static bool persist_modes_config_locked() {
    if (config_path_global.empty()) return false;
    std::ifstream in(config_path_global);
    if (!in.is_open()) {
        std::cerr << "❌ [persist] cannot read " << config_path_global << std::endl;
        return false;
    }
    json doc;
    try { doc = json::parse(in); }
    catch (const std::exception& e) {
        std::cerr << "❌ [persist] parse failed: " << e.what() << std::endl;
        return false;
    }
    in.close();
    if (!doc.contains("coordinator") || !doc["coordinator"].is_object()) {
        doc["coordinator"] = json::object();
    }
    doc["coordinator"]["modes"] = modes_config;
    std::ofstream out(config_path_global);
    if (!out.is_open()) {
        std::cerr << "❌ [persist] cannot write " << config_path_global << std::endl;
        return false;
    }
    out << doc.dump(2);
    return true;
}

static void load_history() {
    std::ifstream f(history_path);
    if (!f.is_open()) return;
    try {
        json arr = json::parse(f);
        if (arr.is_array()) history = arr.get<std::vector<json>>();
    } catch (const std::exception& e) {
        std::cerr << "❌ Failed to parse history: " << e.what() << std::endl;
    }
}

static void save_history() {
    std::ofstream f(history_path);
    if (!f.is_open()) {
        std::cerr << "❌ Failed to open history file for writing: " << history_path << std::endl;
        return;
    }
    f << json(history).dump(2);
}

int main(int argc, char* argv[]) {
    std::string config_path = "swarm-config.json";
    for (int i = 1; i < argc; i++) {
        if (std::string(argv[i]) == "--config" && i + 1 < argc) {
            config_path = argv[i + 1];
            i++;
        }
    }

    config_path_global = config_path;
    history_path = config_path.substr(0, config_path.rfind('/') + 1) + "history.json";
    if (history_path == "history.json") history_path = "history.json";

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
            a.value("model", ""),
            a.value("draft_model", ""),
            a.value("draft_max", 0)
        });
    }
    init_mlx_port_locks(agents);
    std::cout << "✅ Loaded " << agents.size() << " agents from " << config_path << std::endl;

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

    load_history();
    std::cout << "📜 Loaded " << history.size() << " history entries from " << history_path << std::endl;

    httplib::Server svr;

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
            if (!a.backend.empty())     obj["backend"]     = a.backend;
            if (!a.model.empty())       obj["model"]       = a.model;
            if (!a.draft_model.empty()) obj["draft_model"] = a.draft_model;
            if (a.draft_max > 0)        obj["draft_max"]   = a.draft_max;
            list.push_back(obj);
        }
        res.set_content(list.dump(), "application/json");
    });

    // 3. History
    svr.Get("/api/history", [](const httplib::Request&, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        std::lock_guard<std::mutex> lock(history_mutex);
        res.set_content(json(history).dump(), "application/json");
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

    // 4b. Per-mode roster — read & write the agent subset that participates in a mode
    svr.Get(R"(/api/modes/([A-Za-z0-9_-]+)/agents)",
            [](const httplib::Request& req, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        const std::string mode_name = req.matches[1];
        if (!modes::get(mode_name)) {
            res.status = 404;
            res.set_content(json({{"error","unknown mode"},{"mode",mode_name}}).dump(),
                            "application/json");
            return;
        }
        json configured = json::array();
        bool explicit_set = false;
        {
            std::lock_guard<std::mutex> lock(modes_config_mutex);
            if (modes_config.contains(mode_name)
                && modes_config[mode_name].contains("agents")
                && modes_config[mode_name]["agents"].is_array()
                && !modes_config[mode_name]["agents"].empty()) {
                configured = modes_config[mode_name]["agents"];
                explicit_set = true;
            }
        }
        json all = json::array();
        for (const auto& a : agents) all.push_back(a.name);
        json effective = explicit_set ? configured : all;
        json out = {
            {"mode", mode_name},
            {"agents", effective},
            {"explicit", explicit_set},
            {"available", all}
        };
        {
            std::lock_guard<std::mutex> lock(modes_config_mutex);
            if (modes_config.contains(mode_name)
                && modes_config[mode_name].contains("max_select")
                && modes_config[mode_name]["max_select"].is_number_integer()) {
                out["max_select"] = modes_config[mode_name]["max_select"];
            }
            if (modes_config.contains(mode_name)
                && modes_config[mode_name].contains("synthesizer")
                && modes_config[mode_name]["synthesizer"].is_string()) {
                out["synthesizer"] = modes_config[mode_name]["synthesizer"];
            }
        }
        res.set_content(out.dump(), "application/json");
    });

    svr.Put(R"(/api/modes/([A-Za-z0-9_-]+)/agents)",
            [](const httplib::Request& req, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        const std::string mode_name = req.matches[1];
        if (!modes::get(mode_name)) {
            res.status = 404;
            res.set_content(json({{"error","unknown mode"},{"mode",mode_name}}).dump(),
                            "application/json");
            return;
        }
        try {
            auto body = json::parse(req.body);
            const bool has_agents = body.contains("agents") && body["agents"].is_array();
            const bool has_max    = body.contains("max_select") && body["max_select"].is_number_integer();
            const bool has_synth  = body.contains("synthesizer")
                                    && (body["synthesizer"].is_string() || body["synthesizer"].is_null());
            if (!has_agents && !has_max && !has_synth) {
                res.status = 400;
                res.set_content(json({{"error","provide 'agents', 'max_select', or 'synthesizer'"}}).dump(),
                                "application/json");
                return;
            }
            std::set<std::string> active_names;
            for (const auto& a : agents) active_names.insert(a.name);
            json normalized = json::array();
            json unknown = json::array();
            if (has_agents) {
                for (const auto& item : body["agents"]) {
                    if (!item.is_string()) continue;
                    const std::string n = item.get<std::string>();
                    if (active_names.count(n)) normalized.push_back(n);
                    else unknown.push_back(n);
                }
            }
            int max_select_val = 0;
            if (has_max) {
                max_select_val = body["max_select"].get<int>();
                if (max_select_val < 1) max_select_val = 1;
            }
            bool persisted = false;
            {
                std::lock_guard<std::mutex> lock(modes_config_mutex);
                if (!modes_config.contains(mode_name) || !modes_config[mode_name].is_object()) {
                    modes_config[mode_name] = json::object();
                }
                if (has_agents) modes_config[mode_name]["agents"] = normalized;
                if (has_max)    modes_config[mode_name]["max_select"] = max_select_val;
                if (has_synth) {
                    if (body["synthesizer"].is_null()
                        || body["synthesizer"].get<std::string>().empty()) {
                        modes_config[mode_name].erase("synthesizer");
                    } else {
                        const std::string sn = body["synthesizer"].get<std::string>();
                        if (active_names.count(sn)) {
                            modes_config[mode_name]["synthesizer"] = sn;
                        } else {
                            unknown.push_back(sn);
                        }
                    }
                }
                persisted = persist_modes_config_locked();
            }
            std::cout << "🧩 [modes/" << mode_name << "/agents] "
                      << (has_agents ? std::to_string(normalized.size()) + " agent(s) " : "")
                      << (has_max ? "max_select=" + std::to_string(max_select_val) : "")
                      << (persisted ? "" : " (persistence FAILED)") << std::endl;
            json out = {
                {"mode", mode_name},
                {"agents", normalized},
                {"unknown", unknown},
                {"persisted", persisted}
            };
            if (has_max) out["max_select"] = max_select_val;
            res.set_content(out.dump(), "application/json");
        } catch (const std::exception& e) {
            std::cerr << "❌ [modes/agents PUT] " << e.what() << std::endl;
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
                std::lock_guard<std::mutex> lock(modes_config_mutex);
                cfg_for_mode = modes_config.contains(mode_name)
                    ? modes_config[mode_name] : json::object();
            }
            std::vector<Agent> mode_agents = filter_agents_for_mode(mode_name);
            ModeContext ctx{mode_agents, user_prompt, temperature, cfg_for_mode};

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

            {
                std::lock_guard<std::mutex> lock(history_mutex);
                history.push_back(entry);
                save_history();
            }

            res.set_content(envelope.dump(), "application/json");
            std::cout << "✅ [Swarm Matrix] Response sent (mode=" << mode_name << ")" << std::endl;

        } catch (const std::exception& e) {
            std::cerr << "❌ [Swarm Matrix] Error: " << e.what() << std::endl;
            res.status = 400;
            res.set_content("{\"error\":\"Invalid JSON or logic error\"}", "application/json");
        }
    });

    // 5b. Streaming flat-mode dispatch (SSE). MVP: fans out to every agent in
    // parallel, multiplexes their token deltas as SSE events tagged by agent.
    // Llama agents stream live; MLX agents emit one chunk on completion.
    svr.Post("/api/architect/stream", [](const httplib::Request& req, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        std::string user_prompt;
        try {
            auto j = json::parse(req.body);
            user_prompt = j.value("prompt", "");
        } catch (...) {
            user_prompt = req.body;  // accept raw body too
        }
        if (user_prompt.empty()) {
            res.status = 400;
            res.set_content("{\"error\":\"empty prompt\"}", "application/json");
            return;
        }

        // Snapshot agents into a shared_ptr so the chunked provider (which may
        // outlive this lambda's stack frame) keeps them alive.
        auto agents_snap = std::make_shared<std::vector<Agent>>(
            filter_agents_for_mode(modes::active()));
        auto prompt_snap = std::make_shared<std::string>(user_prompt);
        auto cancel = std::make_shared<std::atomic<bool>>(false);

        res.set_chunked_content_provider("text/event-stream",
            [agents_snap, prompt_snap, cancel]
            (size_t /*offset*/, httplib::DataSink& sink) -> bool {
                std::mutex sink_mu;
                auto write_event = [&](const std::string& event,
                                       const std::string& data_json) {
                    std::lock_guard<std::mutex> lock(sink_mu);
                    if (!sink.is_writable()) { cancel->store(true); return; }
                    std::string frame = "event: " + event + "\ndata: "
                                        + data_json + "\n\n";
                    sink.write(frame.data(), frame.size());
                };

                std::vector<std::thread> threads;
                threads.reserve(agents_snap->size());
                for (const auto& a : *agents_snap) {
                    threads.emplace_back([&a, prompt_snap, cancel, &write_event]() {
                        auto on_chunk = [&](const std::string& delta) {
                            json payload = {{"agent", a.name}, {"delta", delta}};
                            write_event("token", payload.dump());
                        };
                        try {
                            agent_stream::stream_agent(a, a.system_prompt,
                                                       *prompt_snap, on_chunk,
                                                       cancel.get());
                        } catch (const std::exception& e) {
                            json err = {{"agent", a.name}, {"error", e.what()}};
                            write_event("error", err.dump());
                        }
                        json done = {{"agent", a.name}};
                        write_event("agent_done", done.dump());
                    });
                }
                for (auto& t : threads) t.join();

                {
                    std::lock_guard<std::mutex> lock(sink_mu);
                    if (sink.is_writable()) {
                        std::string fin = "event: done\ndata: [DONE]\n\n";
                        sink.write(fin.data(), fin.size());
                    }
                    sink.done();
                }
                return true;
            });
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

    // 7. KV pressure aggregator (slots + props + metrics per llama-server)
    register_pressure_routes(svr, agents);
    // 7b. Targeted per-slot eviction for over-pressure llama-servers
    register_eviction_routes(svr, agents);

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
    if (config.contains("coordinator") && config["coordinator"].contains("cache")) {
        const auto& c = config["coordinator"]["cache"];
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
    svr.Options(R"(/api/.*)", [](const httplib::Request&, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        res.set_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
        res.set_header("Access-Control-Allow-Headers", "Content-Type");
        res.status = 204;
    });

    std::cout << "🌐 Swarm Matrix coordinator ONLINE (port 8000)" << std::endl;
    svr.listen("0.0.0.0", 8000);
    return 0;
}
