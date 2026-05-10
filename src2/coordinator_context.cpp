#include "coordinator_context.h"
#include "session_store.h"
#include "swarm_config_store.h"
#include "config/http_url_parse.h"

#include "httplib.h"

#include <cstdlib>
#include <fstream>
#include <iostream>
#include <mutex>

using json = nlohmann::json;

namespace {

bool coordinator_push_modes_presets_remote(CoordinatorState& st) {
    const char* raw = std::getenv("MATRIX_SWARM_CONFIG_SERVICE");
    if (!raw || !*raw) return false;
    std::string host;
    int port = 0;
    if (!matrix_http::parse_http_host_port(std::string(raw), host, port)) {
        std::cerr << "❌ MATRIX_SWARM_CONFIG_SERVICE URL invalid (expected http://host:port)\n";
        return false;
    }
    httplib::Client cli(host, port);
    cli.set_connection_timeout(5);
    cli.set_read_timeout(60);
    auto gr = cli.Get("/api/v1/config");
    if (!gr || gr->status != 200) {
        std::cerr << "❌ remote config GET failed (modes persist)\n";
        return false;
    }
    json doc;
    try {
        doc = json::parse(gr->body);
    } catch (...) {
        std::cerr << "❌ remote config JSON parse failed\n";
        return false;
    }
    if (!doc.contains("coordinator") || !doc["coordinator"].is_object())
        doc["coordinator"] = json::object();
    doc["coordinator"]["modes"] = st.modes_config;
    {
        std::lock_guard<std::mutex> lk(st.presets_mutex);
        if (!st.presets.empty())
            doc["coordinator"]["presets"] = st.presets;
        else
            doc["coordinator"].erase("presets");
    }
    auto pr = cli.Put("/api/v1/config", doc.dump(), "application/json");
    if (!pr || pr->status != 200) {
        std::cerr << "❌ remote config PUT failed (modes persist)\n";
        return false;
    }
    st.startup_config = doc;
    std::cout << "💾 [persist] modes/presets → MATRIX_SWARM_CONFIG_SERVICE\n";
    return true;
}

}  // namespace

void coordinator_load_history(CoordinatorState& st) {
    std::ifstream f(st.history_path);
    if (!f.is_open()) return;
    try {
        json arr = json::parse(f);
        if (arr.is_array()) st.history = arr.get<std::vector<json>>();
    } catch (const std::exception& e) {
        std::cerr << "❌ Failed to parse history: " << e.what() << std::endl;
    }
}

void coordinator_save_history(CoordinatorState& st) {
    std::ofstream f(st.history_path);
    if (!f.is_open()) {
        std::cerr << "❌ Failed to open history file for writing: " << st.history_path << std::endl;
        return;
    }
    f << json(st.history).dump(2);
}

void coordinator_load_sessions(CoordinatorState& st) {
    session_load(st.sessions, st.sessions_path);
}

void coordinator_save_sessions(CoordinatorState& st) {
    session_save(st.sessions, st.sessions_path);
}

bool coordinator_persist_modes_locked(CoordinatorState& st) {
    if (std::getenv("MATRIX_SWARM_CONFIG_SERVICE") && std::getenv("MATRIX_SWARM_CONFIG_SERVICE")[0]) {
        if (coordinator_push_modes_presets_remote(st))
            return true;
        return false;
    }
    return swarm_mirror_modes_presets(st.swarm_paths(), st.modes_config,
        st.presets_mutex, st.presets);
}
