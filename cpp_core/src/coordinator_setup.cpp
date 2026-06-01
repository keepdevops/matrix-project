#include "coordinator_setup.h"
#include "coordinator_setup_wire.h"
#include "config/coordinator_config_validate.h"
#include "config/http_url_parse.h"
#include "config/swarm_config_dir_load.h"

#include "httplib.h"
#include "json.hpp"

#include <cstdlib>
#include <fstream>
#include <iostream>

bool coordinator_load_config(const std::string& config_path, nlohmann::json& config) {
    const char* cfg_svc = std::getenv("MATRIX_SWARM_CONFIG_SERVICE");
    if (cfg_svc && cfg_svc[0]) {
        std::string host;
        int port = 0;
        if (!matrix_http::parse_http_host_port(std::string(cfg_svc), host, port)) {
            std::cerr << "❌ MATRIX_SWARM_CONFIG_SERVICE must be http://host:port\n";
            return false;
        }
        httplib::Client cli(host, port);
        cli.set_connection_timeout(5);
        cli.set_read_timeout(60);
        auto res = cli.Get("/api/v1/config");
        if (!res || res->status != 200) {
            std::cerr << "❌ MATRIX_SWARM_CONFIG_SERVICE GET /api/v1/config failed\n";
            return false;
        }
        try { config = nlohmann::json::parse(res->body); }
        catch (...) { std::cerr << "❌ config JSON parse failed\n"; return false; }
        std::cout << "✅ Loaded swarm config from MATRIX_SWARM_CONFIG_SERVICE\n";
        return true;
    }
    if (coordinator_config::is_directory_path(config_path)) {
        if (!coordinator_config::load_swarm_config_from_dir(config_path, config)) {
            std::cerr << "❌ failed to load swarm config from directory "
                      << config_path << std::endl;
            return false;
        }
        std::cout << "📂 Loaded swarm config from directory " << config_path
                  << " (" << config["agents"].size() << " agents)" << std::endl;
        return true;
    }
    std::ifstream config_file(config_path);
    if (!config_file.is_open()) {
        std::cerr << "❌ Could not open " << config_path << std::endl;
        return false;
    }
    config = nlohmann::json::parse(config_file);
    return true;
}

void coordinator_set_state_paths(CoordinatorState& state, const std::string& config_path) {
    if (coordinator_config::is_directory_path(config_path)) {
        state.history_path  = "history.json";
        state.sessions_path = "sessions.json";
    } else {
        const std::string dir = config_path.substr(0, config_path.rfind('/') + 1);
        state.history_path  = dir + "history.json";
        state.sessions_path = dir + "sessions.json";
        if (state.history_path  == "history.json")  state.history_path  = "history.json";
        if (state.sessions_path == "sessions.json") state.sessions_path = "sessions.json";
    }
}

void coordinator_wire_agents(CoordinatorState& state, const nlohmann::json& config) {
    setup_wire::wire_agents(state, config);
}

void coordinator_apply_coordinator_section(CoordinatorState& state, const nlohmann::json& config) {
    setup_wire::apply_coordinator_section(state, config);
}
