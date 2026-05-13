#include "coordinator_extras.h"
#include "json.hpp"
#include "modes/mode.h"

#include <fstream>
#include <iostream>
#include <mutex>

using json = nlohmann::json;

namespace {

std::mutex g_extras_mutex;

std::string dir_of(const std::string& path) {
    auto slash = path.rfind('/');
    return slash == std::string::npos ? std::string("") : path.substr(0, slash + 1);
}

std::string sibling(const std::string& config_path, const std::string& name) {
    return dir_of(config_path) + name;
}

json load_json_file(const std::string& path, const json& fallback) {
    std::ifstream f(path);
    if (!f.is_open()) return fallback;
    try { return json::parse(f); }
    catch (const std::exception& e) {
        std::cerr << "[extras] failed to parse " << path << ": " << e.what() << std::endl;
        return fallback;
    }
}

bool save_json_file(const std::string& path, const json& j) {
    std::ofstream f(path);
    if (!f.is_open()) {
        std::cerr << "[extras] failed to write " << path << std::endl;
        return false;
    }
    f << j.dump(2);
    return true;
}

// Persist an updated agent field back into swarm-config.json so it survives
// a coordinator restart. Only updates the matching agent by name.
bool persist_agent_field(const std::string& config_path, const std::string& name,
                         const std::string& key, const json& value) {
    std::ifstream in(config_path);
    if (!in.is_open()) return false;
    json cfg;
    try { cfg = json::parse(in); }
    catch (const std::exception& e) {
        std::cerr << "[extras] persist parse error: " << e.what() << std::endl;
        return false;
    }
    in.close();
    if (!cfg.contains("agents") || !cfg["agents"].is_array()) return false;
    bool found = false;
    for (auto& a : cfg["agents"]) {
        if (a.value("name", "") == name) {
            a[key] = value;
            found = true;
            break;
        }
    }
    if (!found) return false;
    return save_json_file(config_path, cfg);
}

Agent* find_agent(std::vector<Agent>& agents, const std::string& name) {
    for (auto& a : agents) if (a.name == name) return &a;
    return nullptr;
}

void cors(httplib::Response& res) {
    res.set_header("Access-Control-Allow-Origin", "*");
}

void respond_json(httplib::Response& res, int status, const json& body) {
    res.status = status;
    cors(res);
    res.set_content(body.dump(), "application/json");
}

} // namespace

void register_extras_routes(httplib::Server& svr,
                            std::vector<Agent>& agents,
                            const std::string& config_path) {
    const std::string presets_path = sibling(config_path, "presets.json");
    const std::string rosters_path = sibling(config_path, "mode-rosters.json");

    // --- PUT /api/agents/:name/prompt -------------------------------------
    svr.Put(R"(/api/agents/([^/]+)/prompt)",
            [&agents, config_path](const httplib::Request& req, httplib::Response& res) {
        std::lock_guard<std::mutex> lk(g_extras_mutex);
        std::string name = req.matches[1];
        try {
            auto j = json::parse(req.body);
            std::string prompt = j.value("system_prompt", "");
            Agent* a = find_agent(agents, name);
            if (!a) { respond_json(res, 404, {{"error", "unknown agent"}}); return; }
            a->system_prompt = prompt;
            persist_agent_field(config_path, name, "system_prompt", prompt);
            respond_json(res, 200, {{"name", name}, {"system_prompt", prompt}});
        } catch (const std::exception& e) {
            respond_json(res, 400, {{"error", e.what()}});
        }
    });

    // --- PUT /api/agents/:name/description --------------------------------
    svr.Put(R"(/api/agents/([^/]+)/description)",
            [config_path](const httplib::Request& req, httplib::Response& res) {
        std::lock_guard<std::mutex> lk(g_extras_mutex);
        std::string name = req.matches[1];
        try {
            auto j = json::parse(req.body);
            std::string desc = j.value("description", "");
            if (!persist_agent_field(config_path, name, "description", desc)) {
                respond_json(res, 404, {{"error", "unknown agent"}}); return;
            }
            respond_json(res, 200, {{"name", name}, {"description", desc}});
        } catch (const std::exception& e) {
            respond_json(res, 400, {{"error", e.what()}});
        }
    });

    // --- PUT /api/agents/:name/tokens -------------------------------------
    svr.Put(R"(/api/agents/([^/]+)/tokens)",
            [&agents, config_path](const httplib::Request& req, httplib::Response& res) {
        std::lock_guard<std::mutex> lk(g_extras_mutex);
        std::string name = req.matches[1];
        try {
            auto j = json::parse(req.body);
            Agent* a = find_agent(agents, name);
            if (!a) { respond_json(res, 404, {{"error", "unknown agent"}}); return; }
            json out = {{"name", name}};
            bool auto_bumped = false;
            if (j.contains("max_tokens") && j["max_tokens"].is_number_integer()) {
                int mt = j["max_tokens"].get<int>();
                a->max_tokens = mt;
                persist_agent_field(config_path, name, "max_tokens", mt);
                out["max_tokens"] = mt;
                if (mt > 4096 && a->read_timeout_secs < 300) {
                    a->read_timeout_secs = std::min(7200, mt / 10 + 60);
                    auto_bumped = true;
                    persist_agent_field(config_path, name, "read_timeout_secs",
                                        a->read_timeout_secs);
                }
            }
            if (j.contains("read_timeout_secs") && j["read_timeout_secs"].is_number_integer()) {
                a->read_timeout_secs = j["read_timeout_secs"].get<int>();
                persist_agent_field(config_path, name, "read_timeout_secs",
                                    a->read_timeout_secs);
                auto_bumped = false;
            }
            if (j.contains("context") && j["context"].is_number_integer()) {
                int ctx = j["context"].get<int>();
                persist_agent_field(config_path, name, "context", ctx);
                out["context"] = ctx;
            }
            out["read_timeout_secs"] = a->read_timeout_secs;
            out["read_timeout_auto_bumped"] = auto_bumped;
            respond_json(res, 200, out);
        } catch (const std::exception& e) {
            respond_json(res, 400, {{"error", e.what()}});
        }
    });

    // --- GET /api/health/agents -------------------------------------------
    svr.Get("/api/health/agents", [&agents](const httplib::Request&, httplib::Response& res) {
        json out = json::object();
        for (const auto& a : agents) {
            out[a.name] = {
                {"recent_failures", 0},
                {"tripped", false},
                {"cooldown_remaining_ms", 0},
            };
        }
        out["__config"] = {{"window_ms", 60000}, {"fail_threshold", 3}, {"cooldown_ms", 30000}};
        respond_json(res, 200, out);
    });

    // --- Mode rosters (persistence only; routing wired later) -------------
    svr.Get(R"(/api/modes/([^/]+)/agents)",
            [&agents, rosters_path](const httplib::Request& req, httplib::Response& res) {
        std::lock_guard<std::mutex> lk(g_extras_mutex);
        std::string mode = req.matches[1];
        json rosters = load_json_file(rosters_path, json::object());
        json available = json::array();
        for (const auto& a : agents) available.push_back(a.name);
        json entry = rosters.value(mode, json::object());
        bool explicit_set = entry.contains("agents") && entry["agents"].is_array();
        json out = {
            {"mode", mode},
            {"agents", explicit_set ? entry["agents"] : available},
            {"explicit", explicit_set},
            {"available", available},
        };
        for (const auto& k : {"synthesizer", "max_select", "variant_policy", "preset",
                              "synthesis_policy", "classifier_policy", "engine_policy",
                              "stage_context_chars", "order"}) {
            if (entry.contains(k)) out[k] = entry[k];
        }
        respond_json(res, 200, out);
    });

    svr.Put(R"(/api/modes/([^/]+)/agents)",
            [rosters_path](const httplib::Request& req, httplib::Response& res) {
        std::lock_guard<std::mutex> lk(g_extras_mutex);
        std::string mode = req.matches[1];
        try {
            auto j = json::parse(req.body);
            json rosters = load_json_file(rosters_path, json::object());
            json& entry = rosters[mode];
            if (!entry.is_object()) entry = json::object();
            for (const auto& k : {"agents", "synthesizer", "max_select", "variant_policy",
                                  "preset", "synthesis_policy", "classifier_policy",
                                  "engine_policy", "stage_context_chars", "order"}) {
                if (j.contains(k)) entry[k] = j[k];
            }
            save_json_file(rosters_path, rosters);
            respond_json(res, 200, {{"mode", mode}, {"ok", true}});
        } catch (const std::exception& e) {
            respond_json(res, 400, {{"error", e.what()}});
        }
    });

    // --- Presets -----------------------------------------------------------
    svr.Get("/api/presets", [presets_path](const httplib::Request&, httplib::Response& res) {
        std::lock_guard<std::mutex> lk(g_extras_mutex);
        respond_json(res, 200, load_json_file(presets_path, json::object()));
    });

    svr.Put(R"(/api/presets/([^/]+))",
            [presets_path](const httplib::Request& req, httplib::Response& res) {
        std::lock_guard<std::mutex> lk(g_extras_mutex);
        std::string name = req.matches[1];
        try {
            auto bundle = json::parse(req.body);
            json presets = load_json_file(presets_path, json::object());
            presets[name] = bundle;
            save_json_file(presets_path, presets);
            respond_json(res, 200, {{"name", name}, {"bundle", bundle}});
        } catch (const std::exception& e) {
            respond_json(res, 400, {{"error", e.what()}});
        }
    });

    svr.Delete(R"(/api/presets/([^/]+))",
               [presets_path](const httplib::Request& req, httplib::Response& res) {
        std::lock_guard<std::mutex> lk(g_extras_mutex);
        std::string name = req.matches[1];
        json presets = load_json_file(presets_path, json::object());
        if (!presets.contains(name)) {
            respond_json(res, 404, {{"error", "unknown preset"}}); return;
        }
        presets.erase(name);
        save_json_file(presets_path, presets);
        respond_json(res, 200, {{"name", name}, {"deleted", true}});
    });

    svr.Post(R"(/api/presets/([^/]+)/apply)",
             [presets_path, rosters_path](const httplib::Request& req, httplib::Response& res) {
        std::lock_guard<std::mutex> lk(g_extras_mutex);
        std::string name = req.matches[1];
        json presets = load_json_file(presets_path, json::object());
        if (!presets.contains(name)) {
            respond_json(res, 404, {{"error", "unknown preset"}}); return;
        }
        json bundle = presets[name];
        std::string mode = bundle.value("mode", "");
        if (mode.empty()) {
            respond_json(res, 400, {{"error", "preset missing mode"}}); return;
        }
        modes::set_active(mode);
        json rosters = load_json_file(rosters_path, json::object());
        json& entry = rosters[mode];
        if (!entry.is_object()) entry = json::object();
        for (const auto& k : {"agents", "synthesizer", "max_select"}) {
            if (bundle.contains(k)) entry[k] = bundle[k];
        }
        save_json_file(rosters_path, rosters);
        respond_json(res, 200, {{"mode", mode}, {"applied", name}, {"unknown", json::array()}});
    });
}
