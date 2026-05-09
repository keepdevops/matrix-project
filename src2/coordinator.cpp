#include "coordinator_context.h"
#include "coordinator_routes.h"
#include "agent_client.h"
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

    state.history_path = config_path.substr(0, config_path.rfind('/') + 1) + "history.json";
    if (state.history_path == "history.json") state.history_path = "history.json";

    std::ifstream config_file(config_path);
    if (!config_file.is_open()) {
        std::cerr << "❌ Could not open " << config_path << std::endl;
        return 1;
    }
    json config = json::parse(config_file);
    state.startup_config = config;

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
            a.value("draft_max", 0)
        });
    }
    init_mlx_port_locks(state.agents);
    std::cout << "✅ Loaded " << state.agents.size() << " agents from " << config_path << std::endl;

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
