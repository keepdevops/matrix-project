#include "coordinator_context.h"
#include "coordinator_routes.h"
#include "coordinator_setup.h"
#include "telemetry.h"

#include "httplib.h"
#include "json.hpp"

#include "config/coordinator_config_validate.h"
#include "modes/mode.h"

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

    coordinator_set_state_paths(state, config_path);

    json config;
    if (!coordinator_load_config(config_path, config)) return 1;
    state.startup_config = config;

    if (!coordinator_config::validate_swarm_config_document(config, true).ok) {
        std::cerr << "❌ swarm config validation failed\n";
        return 1;
    }

    coordinator_wire_agents(state, config);
    std::cout << "✅ Loaded " << state.agents.size() << " agents from "
              << (std::getenv("MATRIX_SWARM_CONFIG_SERVICE") ? "MATRIX_SWARM_CONFIG_SERVICE" : config_path)
              << std::endl;

    coordinator_apply_coordinator_section(state, config);
    std::cout << "🧠 active mode: " << modes::active() << std::endl;

    coordinator_load_history(state);
    std::cout << "📜 Loaded " << state.history.size() << " history entries from "
              << state.history_path << std::endl;
    coordinator_load_sessions(state);
    std::cout << "🧵 Loaded " << state.sessions.size() << " session(s) from "
              << state.sessions_path << std::endl;

    httplib::Server svr;

    {
        auto& boot = telemetry::Registry::instance().counter(
            "coordinator_boot_total", "Coordinator process starts.");
        boot.Increment();
        auto& loaded = telemetry::Registry::instance().gauge(
            "coordinator_agents_loaded", "Agents loaded from the active swarm config.");
        loaded.Set(static_cast<double>(state.agents.size()));
    }

    svr.Get("/metrics", [](const httplib::Request&, httplib::Response& res) {
        res.set_content(telemetry::Registry::instance().render(),
                        "text/plain; version=0.0.4");
    });
    svr.set_pre_routing_handler(
        [](const httplib::Request& req, httplib::Response&) {
            telemetry::Registry::instance()
                .counter("coordinator_http_requests_total",
                         "Coordinator HTTP requests handled.",
                         {{"method", req.method}})
                .Increment();
            return httplib::Server::HandlerResponse::Unhandled;
        });

    register_coordinator_routes(svr, state);

    int listen_port = 8000;
    if (const char* p = std::getenv("MATRIX_COORDINATOR_PORT")) {
        try { listen_port = std::stoi(p); } catch (...) {}
    }
    std::cout << "🌐 Swarm Matrix coordinator ONLINE — listening on 0.0.0.0:"
              << listen_port << std::endl;
    svr.listen("0.0.0.0", listen_port);
    return 0;
}
