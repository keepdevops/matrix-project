#include "coordinator_context.h"
#include "coordinator_routes.h"
#include "agent_client.h"
#include "config/coordinator_config_validate.h"
#include "config/http_url_parse.h"
#include "config/swarm_config_dir_load.h"
#include "modes/mode.h"

#include "httplib.h"
#include "json.hpp"

#include <cstdlib>
#include <fstream>
#include <iostream>
#include <string>

int main(int argc, char* argv[]) {
    CoordinatorState state;
    std::string config_path = "swarm-config.json";
    for (int i = 1; i < argc; i++) {
        if (std::string(argv[i]) == "--config" && i + 1 < argc) {
            config_path = argv[i + 1];
            i++;
        }
    }

    state.config_path_global = config_path;
    if (const char* src = std::getenv("MATRIX_SOURCE_CONFIG")) {
        state.source_config_path_global = src;
        std::cout << "📎 source config (mirror target): "
                  << state.source_config_path_global << std::endl;
    } else {
        const std::string fallback = "swarm-config.json";
        std::ifstream probe(fallback);
        if (probe.is_open() && fallback != config_path) {
            state.source_config_path_global = fallback;
            std::cout << "📎 source config (mirror target, default): "
                      << state.source_config_path_global << std::endl;
        }
    }

    // When loading from a directory layout, anchor state files at the repo
    // root rather than inside config/ — keeps history.json/sessions.json
    // where the legacy launch scripts expect them.
    if (coordinator_config::is_directory_path(config_path)) {
        state.history_path = "history.json";
        state.sessions_path = "sessions.json";
    } else {
        state.history_path = config_path.substr(0, config_path.rfind('/') + 1) + "history.json";
        if (state.history_path == "history.json") state.history_path = "history.json";
        state.sessions_path = config_path.substr(0, config_path.rfind('/') + 1) + "sessions.json";
        if (state.sessions_path == "sessions.json") state.sessions_path = "sessions.json";
    }

    json config;
    const char* cfg_svc = std::getenv("MATRIX_SWARM_CONFIG_SERVICE");
    if (cfg_svc && cfg_svc[0]) {
        std::string host;
        int port = 0;
        if (!matrix_http::parse_http_host_port(std::string(cfg_svc), host, port)) {
            std::cerr << "❌ MATRIX_SWARM_CONFIG_SERVICE must be http://host:port\n";
            return 1;
        }
        httplib::Client cli(host, port);
        cli.set_connection_timeout(5);
        cli.set_read_timeout(60);
        auto res = cli.Get("/api/v1/config");
        if (!res || res->status != 200) {
            std::cerr << "❌ MATRIX_SWARM_CONFIG_SERVICE GET /api/v1/config failed\n";
            return 1;
        }
        try {
            config = json::parse(res->body);
        } catch (...) {
            std::cerr << "❌ config JSON parse failed\n";
            return 1;
        }
        std::cout << "✅ Loaded swarm config from MATRIX_SWARM_CONFIG_SERVICE\n";
    } else if (coordinator_config::is_directory_path(config_path)) {
        if (!coordinator_config::load_swarm_config_from_dir(config_path, config)) {
            std::cerr << "❌ failed to load swarm config from directory "
                      << config_path << std::endl;
            return 1;
        }
        std::cout << "📂 Loaded swarm config from directory " << config_path
                  << " (" << config["agents"].size() << " agents)" << std::endl;
    } else {
        std::ifstream config_file(config_path);
        if (!config_file.is_open()) {
            std::cerr << "❌ Could not open " << config_path << std::endl;
            return 1;
        }
        config = json::parse(config_file);
    }
    state.startup_config = config;

    if (!coordinator_config::validate_swarm_config_document(config, true).ok) {
        std::cerr << "❌ swarm config validation failed\n";
        return 1;
    }

    for (auto& a : config["agents"]) {
        std::string backend_val = a.contains("backend") ? a["backend"].get<std::string>() : "";
        std::string engine = a.contains("engine") ? a["engine"].get<std::string>()
                             : (backend_val == "mlx" ? "mlx"
                               : backend_val == "docker" ? "docker" : "llama");
        state.agents.push_back({
            a["name"].get<std::string>(),
            a["port"].get<int>(),
            a["read_timeout_secs"].get<int>(),
            a["max_tokens"].get<int>(),
            a["system_prompt"].get<std::string>(),
            a.value("description", ""),
            backend_val,
            engine,
            a.value("model", ""),
            a.value("draft_model", ""),
            a.value("draft_max", 0),
            a.value("context", 8192)
        });
    }
    init_mlx_port_locks(state.agents);
    std::cout << "✅ Loaded " << state.agents.size() << " agents from "
              << ((cfg_svc && cfg_svc[0]) ? std::string("MATRIX_SWARM_CONFIG_SERVICE") : config_path)
              << std::endl;

    if (config.contains("coordinator")) {
        const auto& coord = config["coordinator"];
        if (coord.contains("modes") && coord["modes"].is_object()) {
            state.modes_config = coord["modes"];
        }
        if (coord.contains("presets") && coord["presets"].is_object()) {
            state.presets = coord["presets"];
            std::cout << "🎛️  loaded " << state.presets.size() << " preset(s)" << std::endl;
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

    coordinator_load_history(state);
    std::cout << "📜 Loaded " << state.history.size() << " history entries from "
              << state.history_path << std::endl;
    coordinator_load_sessions(state);
    std::cout << "🧵 Loaded " << state.sessions.size() << " session(s) from "
              << state.sessions_path << std::endl;

    httplib::Server svr;
    register_coordinator_routes(svr, state);

    std::cout << "🌐 Swarm Matrix coordinator ONLINE (port 8000)" << std::endl;
    int listen_port = 8000;
    if (const char* p = std::getenv("MATRIX_COORDINATOR_PORT")) {
        try { listen_port = std::stoi(p); } catch (...) {}
    }
    std::cout << "🌐 listening on 0.0.0.0:" << listen_port << std::endl;
    svr.listen("0.0.0.0", listen_port);
    return 0;
}
