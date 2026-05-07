#include "httplib.h"
#include "json.hpp"
#include "agent.h"
#include "agent_client.h"
#include "agent_health.h"
#include "agent_metrics.h"
#include "agent_stream.h"
#include "modes/mode.h"
#include "pressure.h"
#include "response_cache.h"

#include <algorithm>
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

// Named preset bundles: { name: { mode, agents, synthesizer?, max_select? } }
// Stored alongside modes_config under coordinator.presets in the config file
// so they survive both restart and UI redeploy. Applying a preset copies its
// fields into modes_config[mode] and sets the active mode.
static json presets = json::object();
static std::mutex presets_mutex;
static std::string config_path_global;
// Optional secondary persist target. When the active config file (e.g.
// /tmp/matrix-active-config.json) differs from the user-editable source
// (project-root swarm-config.json), per-mode edits silently vanish on the
// next deploy because proxy_configure reads `coordinator.modes` from source.
// Setting MATRIX_SOURCE_CONFIG mirrors persists to that source file too.
static std::string source_config_path_global;

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

// Read JSON config from path; returns true if doc populated.
static bool read_config_doc(const std::string& path, json& doc) {
    std::ifstream in(path);
    if (!in.is_open()) {
        std::cerr << "❌ [persist] cannot read " << path << std::endl;
        return false;
    }
    try { doc = json::parse(in); }
    catch (const std::exception& e) {
        std::cerr << "❌ [persist] parse failed (" << path << "): " << e.what() << std::endl;
        return false;
    }
    return true;
}

// Write coordinator state (modes + presets) into a config file, preserving
// everything else. Returns true on success.
static bool write_modes_to(const std::string& path) {
    if (path.empty()) return false;
    json doc;
    if (!read_config_doc(path, doc)) return false;
    if (!doc.contains("coordinator") || !doc["coordinator"].is_object()) {
        doc["coordinator"] = json::object();
    }
    doc["coordinator"]["modes"] = modes_config;
    {
        std::lock_guard<std::mutex> lk(presets_mutex);
        if (!presets.empty()) {
            doc["coordinator"]["presets"] = presets;
        } else {
            doc["coordinator"].erase("presets");
        }
    }
    std::ofstream out(path);
    if (!out.is_open()) {
        std::cerr << "❌ [persist] cannot write " << path << std::endl;
        return false;
    }
    out << doc.dump(2);
    return true;
}

// Persist modes_config to the active config file and, when configured, mirror
// to the user-editable source so per-mode rosters survive a UI redeploy.
// Caller must hold modes_config_mutex.
static bool persist_modes_config_locked() {
    bool ok = write_modes_to(config_path_global);
    if (!source_config_path_global.empty()
        && source_config_path_global != config_path_global) {
        bool src_ok = write_modes_to(source_config_path_global);
        if (src_ok) {
            std::cout << "💾 [persist] mirrored modes to source "
                      << source_config_path_global << std::endl;
        } else {
            std::cerr << "⚠️  [persist] active config saved but source "
                      << source_config_path_global
                      << " could not be updated (edits will not survive redeploy)"
                      << std::endl;
        }
    }
    return ok;
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
    if (const char* src = std::getenv("MATRIX_SOURCE_CONFIG")) {
        source_config_path_global = src;
        std::cout << "📎 source config (mirror target): "
                  << source_config_path_global << std::endl;
    }
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
        if (coord.contains("presets") && coord["presets"].is_object()) {
            presets = coord["presets"];
            std::cout << "🎛️  loaded " << presets.size() << " preset(s)" << std::endl;
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

    // 4c. Per-agent health — circuit breaker state for diagnostic / UI use
    svr.Get("/api/health/agents",
            [](const httplib::Request&, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        res.set_content(agent_health::snapshot().dump(), "application/json");
    });

    // 4c2. Agent prompt editing — change an agent's system_prompt at runtime.
    // Persists to active config + mirror; survives restart and redeploy.
    // PUT /api/agents/<name>/prompt {"system_prompt": "..."}
    svr.Put(R"(/api/agents/([A-Za-z0-9_\-]+)/prompt)",
            [](const httplib::Request& req, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        const std::string name = req.matches[1];
        Agent* target = nullptr;
        for (auto& a : agents) if (a.name == name) { target = &a; break; }
        if (!target) {
            res.status = 404;
            res.set_content(json({{"error","unknown agent"},{"name",name}}).dump(),
                            "application/json");
            return;
        }
        try {
            auto body = json::parse(req.body);
            if (!body.contains("system_prompt") || !body["system_prompt"].is_string()) {
                res.status = 400;
                res.set_content(json({{"error","missing 'system_prompt' string"}}).dump(),
                                "application/json");
                return;
            }
            const std::string new_prompt = body["system_prompt"].get<std::string>();
            target->system_prompt = new_prompt;

            // Persist by rewriting the agents block in both config files.
            auto rewrite = [&](const std::string& path) -> bool {
                if (path.empty()) return false;
                json doc;
                if (!read_config_doc(path, doc)) return false;
                if (!doc.contains("agents") || !doc["agents"].is_array()) return false;
                bool found = false;
                for (auto& a : doc["agents"]) {
                    if (a.is_object() && a.value("name", std::string()) == name) {
                        a["system_prompt"] = new_prompt;
                        found = true;
                        break;
                    }
                }
                if (!found) return false;
                std::ofstream out(path);
                if (!out.is_open()) return false;
                out << doc.dump(2);
                return true;
            };
            bool active_ok = rewrite(config_path_global);
            bool source_ok = source_config_path_global.empty() ? true
                : rewrite(source_config_path_global);
            std::cout << "✏️  [agents/" << name << "/prompt] updated ("
                      << new_prompt.size() << " chars)";
            if (!active_ok) std::cout << " — active write FAILED";
            if (!source_ok) std::cout << " — source write FAILED";
            std::cout << std::endl;
            response_cache::clear();  // old cached responses came from old prompt
            res.set_content(json({
                {"name", name},
                {"system_prompt", new_prompt},
                {"persisted", active_ok && source_ok}
            }).dump(), "application/json");
        } catch (const std::exception& e) {
            std::cerr << "❌ [agents prompt PUT] " << e.what() << std::endl;
            res.status = 400;
            res.set_content(json({{"error", e.what()}}).dump(), "application/json");
        }
    });

    // 4d. Mode presets — named bundles of (mode, agents, synthesizer, max_select).
    // Saved to coordinator.presets in the config file; survive restart + redeploy.
    svr.Get("/api/presets", [](const httplib::Request&, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        std::lock_guard<std::mutex> lk(presets_mutex);
        res.set_content(presets.dump(), "application/json");
    });

    svr.Put(R"(/api/presets/([A-Za-z0-9_\-]+))",
            [](const httplib::Request& req, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        const std::string name = req.matches[1];
        try {
            auto body = json::parse(req.body);
            if (!body.contains("mode") || !body["mode"].is_string()
                || !modes::get(body["mode"].get<std::string>())) {
                res.status = 400;
                res.set_content(json({{"error","missing or unknown 'mode'"}}).dump(),
                                "application/json");
                return;
            }
            json bundle = json::object();
            bundle["mode"] = body["mode"];
            if (body.contains("agents") && body["agents"].is_array()) {
                bundle["agents"] = body["agents"];
            }
            if (body.contains("synthesizer") && body["synthesizer"].is_string()
                && !body["synthesizer"].get<std::string>().empty()) {
                bundle["synthesizer"] = body["synthesizer"];
            }
            if (body.contains("max_select") && body["max_select"].is_number_integer()) {
                bundle["max_select"] = body["max_select"];
            }
            bool persisted = false;
            {
                std::lock_guard<std::mutex> lk(presets_mutex);
                presets[name] = bundle;
            }
            {
                std::lock_guard<std::mutex> lk(modes_config_mutex);
                persisted = persist_modes_config_locked();
            }
            std::cout << "🎛️  [presets] saved '" << name << "' (mode="
                      << bundle["mode"].get<std::string>() << ")" << std::endl;
            res.set_content(json({
                {"name", name}, {"preset", bundle}, {"persisted", persisted}
            }).dump(), "application/json");
        } catch (const std::exception& e) {
            std::cerr << "❌ [presets PUT] " << e.what() << std::endl;
            res.status = 400;
            res.set_content(json({{"error", e.what()}}).dump(), "application/json");
        }
    });

    svr.Delete(R"(/api/presets/([A-Za-z0-9_\-]+))",
               [](const httplib::Request& req, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        const std::string name = req.matches[1];
        bool removed = false;
        {
            std::lock_guard<std::mutex> lk(presets_mutex);
            removed = presets.erase(name) > 0;
        }
        if (removed) {
            std::lock_guard<std::mutex> lk(modes_config_mutex);
            persist_modes_config_locked();
            std::cout << "🗑️  [presets] removed '" << name << "'" << std::endl;
        }
        res.set_content(json({{"name", name}, {"removed", removed}}).dump(),
                        "application/json");
    });

    // POST /api/presets/<name>/apply — copy preset into modes_config[<mode>],
    // set that mode active, and persist. Idempotent.
    svr.Post(R"(/api/presets/([A-Za-z0-9_\-]+)/apply)",
             [](const httplib::Request& req, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        const std::string name = req.matches[1];
        json bundle;
        {
            std::lock_guard<std::mutex> lk(presets_mutex);
            if (!presets.contains(name)) {
                res.status = 404;
                res.set_content(json({{"error","unknown preset"},{"name",name}}).dump(),
                                "application/json");
                return;
            }
            bundle = presets[name];
        }
        const std::string mode_name = bundle.value("mode", std::string(""));
        if (mode_name.empty() || !modes::get(mode_name)) {
            res.status = 400;
            res.set_content(json({{"error","preset references unknown mode"},
                                   {"mode",mode_name}}).dump(),
                            "application/json");
            return;
        }
        // Build per-mode block from preset, validating agent names.
        std::set<std::string> active_names;
        for (const auto& a : agents) active_names.insert(a.name);
        json block = json::object();
        json unknown = json::array();
        if (bundle.contains("agents") && bundle["agents"].is_array()) {
            json kept = json::array();
            for (const auto& it : bundle["agents"]) {
                if (!it.is_string()) continue;
                const std::string n = it.get<std::string>();
                if (active_names.count(n)) kept.push_back(n);
                else unknown.push_back(n);
            }
            if (!kept.empty()) block["agents"] = kept;
        }
        if (bundle.contains("synthesizer") && bundle["synthesizer"].is_string()) {
            const std::string sn = bundle["synthesizer"].get<std::string>();
            if (active_names.count(sn)) block["synthesizer"] = sn;
            else unknown.push_back(sn);
        }
        if (bundle.contains("max_select") && bundle["max_select"].is_number_integer()) {
            block["max_select"] = bundle["max_select"];
        }
        bool persisted = false;
        {
            std::lock_guard<std::mutex> lk(modes_config_mutex);
            // Preserve any non-roster fields (e.g. router.classifier) by merging.
            if (!modes_config.contains(mode_name) || !modes_config[mode_name].is_object()) {
                modes_config[mode_name] = json::object();
            }
            // Drop fields the preset owns so a smaller preset doesn't inherit
            // stale agents/synthesizer/max_select from a previous edit.
            modes_config[mode_name].erase("agents");
            modes_config[mode_name].erase("synthesizer");
            modes_config[mode_name].erase("max_select");
            for (auto it = block.begin(); it != block.end(); ++it) {
                modes_config[mode_name][it.key()] = it.value();
            }
            persisted = persist_modes_config_locked();
        }
        modes::set_active(mode_name);
        std::cout << "🎛️  [presets] applied '" << name << "' → mode="
                  << mode_name << std::endl;
        res.set_content(json({
            {"name", name}, {"mode", mode_name},
            {"applied", block}, {"unknown", unknown},
            {"persisted", persisted}
        }).dump(), "application/json");
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
            // Circuit breaker: drop agents whose health breaker is open.
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
            user_prompt = req.body;
        }
        if (user_prompt.empty()) {
            res.status = 400;
            res.set_content("{\"error\":\"empty prompt\"}", "application/json");
            return;
        }

        const std::string mode_name = modes::active();
        json cfg_for_mode;
        {
            std::lock_guard<std::mutex> lock(modes_config_mutex);
            cfg_for_mode = modes_config.contains(mode_name)
                ? modes_config[mode_name] : json::object();
        }
        auto filtered = filter_agents_for_mode(mode_name);
        filtered.erase(std::remove_if(filtered.begin(), filtered.end(),
            [](const Agent& a){ return agent_health::is_open(a.name); }),
            filtered.end());

        auto agents_snap = std::make_shared<std::vector<Agent>>(std::move(filtered));
        auto prompt_snap = std::make_shared<std::string>(user_prompt);
        auto cfg_snap    = std::make_shared<json>(std::move(cfg_for_mode));
        auto mode_snap   = std::make_shared<std::string>(mode_name);
        auto cancel      = std::make_shared<std::atomic<bool>>(false);
        agent_metrics::reset();

        res.set_chunked_content_provider("text/event-stream",
            [agents_snap, prompt_snap, cfg_snap, mode_snap, cancel]
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

                // Resolve synthesizer once for cascade/pipeline.
                std::string synth_name;
                if (cfg_snap->contains("synthesizer")
                    && (*cfg_snap)["synthesizer"].is_string()) {
                    synth_name = (*cfg_snap)["synthesizer"].get<std::string>();
                }
                const Agent* synth_agent = nullptr;
                for (const auto& a : *agents_snap) {
                    if (a.name == synth_name) { synth_agent = &a; break; }
                }

                // Helper: parallel-stream a list of agents and collect outputs.
                auto stream_parallel = [&](const std::vector<const Agent*>& agents,
                                           std::map<std::string, std::string>& outputs) {
                    std::mutex out_mu;
                    std::vector<std::thread> threads;
                    threads.reserve(agents.size());
                    for (const Agent* a : agents) {
                        threads.emplace_back([a, prompt_snap, cancel,
                                              &write_event, &outputs, &out_mu]() {
                            std::string assembled;
                            auto on_chunk = [&](const std::string& delta) {
                                assembled += delta;
                                json payload = {{"agent", a->name}, {"delta", delta}};
                                write_event("token", payload.dump());
                            };
                            try {
                                agent_stream::stream_agent(*a, a->system_prompt,
                                                           *prompt_snap, on_chunk,
                                                           cancel.get());
                            } catch (const std::exception& e) {
                                json err = {{"agent", a->name}, {"error", e.what()}};
                                write_event("error", err.dump());
                            }
                            {
                                std::lock_guard<std::mutex> lk(out_mu);
                                outputs[a->name] = assembled;
                            }
                            json done = {{"agent", a->name}};
                            write_event("agent_done", done.dump());
                        });
                    }
                    for (auto& t : threads) t.join();
                };

                auto run_synthesis = [&](const std::vector<std::string>& contributors,
                                         std::map<std::string, std::string>& outputs) {
                    if (!synth_agent || contributors.empty()) return;
                    std::string sp;
                    sp += "Original user request:\n<<<\n";
                    sp += *prompt_snap;
                    sp += "\n>>>\n\nThe following agents contributed:\n";
                    int n = 0;
                    for (const auto& nm : contributors) {
                        ++n;
                        sp += "\n--- " + std::to_string(n) + " (" + nm + ") ---\n";
                        sp += outputs[nm];
                    }
                    sp += "\n\nProduce ONE consolidated answer that integrates the "
                          "above contributions. Resolve contradictions, drop redundancy. "
                          "Write the final answer directly.";
                    write_event("synthesis_start",
                        json({{"agent", synth_agent->name}}).dump());
                    auto on_chunk = [&](const std::string& delta) {
                        json payload = {{"agent", synth_agent->name}, {"delta", delta}};
                        write_event("token", payload.dump());
                    };
                    try {
                        agent_stream::stream_agent(*synth_agent,
                            synth_agent->system_prompt, sp, on_chunk, cancel.get());
                    } catch (const std::exception& e) {
                        write_event("error",
                            json({{"agent", synth_agent->name}, {"error", e.what()}}).dump());
                    }
                    write_event("agent_done",
                        json({{"agent", synth_agent->name}}).dump());
                };

                std::map<std::string, std::string> outputs;
                std::vector<std::string> participants;

                if (*mode_snap == "pipeline") {
                    // Sequential streaming. Order: mode_config["agents"] if set,
                    // else ctx.agents in roster order. Synthesizer (if any) runs
                    // last and is excluded from the chain.
                    std::vector<const Agent*> order;
                    if (cfg_snap->contains("agents") && (*cfg_snap)["agents"].is_array()
                        && !(*cfg_snap)["agents"].empty()) {
                        std::map<std::string, const Agent*> by_name;
                        for (const auto& a : *agents_snap) by_name[a.name] = &a;
                        for (const auto& n : (*cfg_snap)["agents"]) {
                            if (!n.is_string()) continue;
                            const std::string nm = n.get<std::string>();
                            if (nm == synth_name) continue;
                            auto it = by_name.find(nm);
                            if (it != by_name.end()) order.push_back(it->second);
                        }
                    } else {
                        for (const auto& a : *agents_snap) {
                            if (a.name == synth_name) continue;
                            order.push_back(&a);
                        }
                    }
                    int total = (int)order.size();
                    int step = 0;
                    std::string prev_agent, prev_output;
                    for (const Agent* a : order) {
                        ++step;
                        write_event("stage", json({
                            {"step", step}, {"total", total}, {"agent", a->name}
                        }).dump());
                        std::string staged = prev_agent.empty() ? *prompt_snap :
                            ("Original user request:\n<<<\n" + *prompt_snap +
                             "\n>>>\n\nPrevious step (" + prev_agent + ") produced:\n<<<\n" +
                             prev_output + "\n>>>\n\nContinue the pipeline.");
                        std::string assembled;
                        auto on_chunk = [&](const std::string& delta) {
                            assembled += delta;
                            json payload = {{"agent", a->name}, {"delta", delta}};
                            write_event("token", payload.dump());
                        };
                        try {
                            agent_stream::stream_agent(*a, a->system_prompt,
                                staged, on_chunk, cancel.get());
                        } catch (const std::exception& e) {
                            write_event("error",
                                json({{"agent", a->name}, {"error", e.what()}}).dump());
                        }
                        outputs[a->name] = assembled;
                        participants.push_back(a->name);
                        prev_agent = a->name;
                        prev_output = assembled;
                        write_event("agent_done",
                            json({{"agent", a->name}}).dump());
                    }
                    run_synthesis(participants, outputs);

                } else if (*mode_snap == "router") {
                    // Classify synchronously, stream the chosen agents in parallel.
                    // Streaming the classifier itself isn't useful — its output is
                    // a one-line SELECTED directive the user shouldn't see.
                    std::string classifier_name = cfg_snap->value("classifier", std::string(""));
                    int max_select = cfg_snap->value("max_select", 3);
                    std::map<std::string, const Agent*> by_name;
                    for (const auto& a : *agents_snap) by_name[a.name] = &a;
                    if (classifier_name.empty() || !by_name.count(classifier_name)) {
                        // Fallback: use first active agent as classifier.
                        if (!agents_snap->empty()) classifier_name = agents_snap->front().name;
                    }
                    std::vector<std::string> choices;
                    for (const auto& a : *agents_snap) {
                        if (a.name != classifier_name) choices.push_back(a.name);
                    }
                    std::string choices_csv;
                    for (size_t i = 0; i < choices.size(); ++i) {
                        if (i) choices_csv += ", ";
                        choices_csv += choices[i];
                    }
                    std::string classifier_user =
                        "Allowed agents: " + choices_csv + "\n\nUser request:\n" +
                        *prompt_snap + "\n\nRespond with one line: SELECTED: <agents>.";
                    std::string classifier_system =
                        "You are a routing classifier. Pick 1-" + std::to_string(max_select) +
                        " agents from the allowed list. Respond with exactly one line: "
                        "SELECTED: <a>, <b>. No prose.";
                    std::string raw;
                    if (by_name.count(classifier_name)) {
                        try {
                            raw = call_agent_with_system(*by_name[classifier_name],
                                classifier_system, classifier_user);
                        } catch (...) { raw = ""; }
                    }
                    // Parse SELECTED line.
                    std::vector<std::string> picked;
                    auto pos = raw.find("SELECTED:");
                    if (pos != std::string::npos) {
                        std::string tail = raw.substr(pos + 9);
                        auto eol = tail.find('\n');
                        if (eol != std::string::npos) tail = tail.substr(0, eol);
                        std::string token;
                        for (char c : tail + ',') {
                            if (c == ',') {
                                while (!token.empty() && (token.front() == ' ' || token.front() == '\t')) token.erase(token.begin());
                                while (!token.empty() && (token.back() == ' ' || token.back() == '\t' || token.back() == '.')) token.pop_back();
                                if (!token.empty() && by_name.count(token)
                                    && token != classifier_name) {
                                    picked.push_back(token);
                                    if ((int)picked.size() >= max_select) break;
                                }
                                token.clear();
                            } else {
                                token += c;
                            }
                        }
                    }
                    if (picked.empty() && !choices.empty()) {
                        // Fallback: take first allowed.
                        picked.push_back(choices.front());
                    }
                    write_event("selected", json({
                        {"classifier", classifier_name},
                        {"agents", picked}
                    }).dump());
                    std::vector<const Agent*> selected_agents;
                    for (const auto& n : picked) selected_agents.push_back(by_name[n]);
                    stream_parallel(selected_agents, outputs);

                } else {
                    // flat / cascade: parallel broadcast (excluding synthesizer).
                    std::vector<const Agent*> bcast;
                    for (const auto& a : *agents_snap) {
                        if (a.name == synth_name) continue;
                        bcast.push_back(&a);
                        participants.push_back(a.name);
                    }
                    stream_parallel(bcast, outputs);
                    if (*mode_snap == "cascade") {
                        run_synthesis(participants, outputs);
                    }
                }

                // Emit a final `metrics` event with per-agent timings collected
                // during the streaming dispatch. Clients can ignore it; UI
                // dashboards can render it.
                json metrics = agent_metrics::snapshot();
                write_event("metrics", metrics.dump());

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
    int listen_port = 8000;
    if (const char* p = std::getenv("MATRIX_COORDINATOR_PORT")) {
        try { listen_port = std::stoi(p); } catch (...) {}
    }
    std::cout << "🌐 listening on 0.0.0.0:" << listen_port << std::endl;
    svr.listen("0.0.0.0", listen_port);
    return 0;
}
