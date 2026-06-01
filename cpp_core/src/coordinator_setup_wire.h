#pragma once
// Inline agent-wiring helpers — included only by coordinator_setup.cpp.

#include "coordinator_setup.h"
#include "agent_client.h"
#include "modes/mode.h"
#include <iostream>
#include <string>

namespace setup_wire {

inline void wire_agents(CoordinatorState& state, const nlohmann::json& config) {
    for (auto& a : config["agents"]) {
        std::string backend_val = a.contains("backend") ? a["backend"].get<std::string>() : "";
        std::string engine = a.contains("engine") ? a["engine"].get<std::string>()
                             : (backend_val == "mlx" ? "mlx"
                               : backend_val == "docker" ? "docker" : "llama");
        int max_conc = a.contains("max_concurrency") && a["max_concurrency"].is_number_integer()
                       ? a["max_concurrency"].get<int>()
                       : (engine == "mlx" ? 1 : 0);
        Agent ag;
        ag.name              = a["name"].get<std::string>();
        ag.port              = a.value("port", 8080);
        ag.read_timeout_secs = a.value("read_timeout_secs", 120);
        ag.max_tokens        = a.value("max_tokens", 1024);
        ag.system_prompt     = a.value("system_prompt", std::string(""));
        ag.description       = a.value("description", "");
        if (a.contains("tags") && a["tags"].is_array())
            for (const auto& t : a["tags"])
                if (t.is_string()) ag.tags.push_back(t.get<std::string>());
        ag.backend         = backend_val;
        ag.engine          = engine;
        ag.model           = a.value("model", "");
        ag.draft_model     = a.value("draft_model", "");
        ag.draft_max         = a.value("draft_max", 0);
        ag.max_input_tokens  = a.value("max_input_tokens", 0);
        ag.max_output_tokens = a.value("max_output_tokens", 0);
        ag.context_window  = a.value("context", 8192);
        ag.max_concurrency = max_conc;
        state.agents.push_back(ag);
    }
    init_port_concurrency(state.agents);
}

inline void apply_coordinator_section(CoordinatorState& state, const nlohmann::json& config) {
    if (!config.contains("coordinator")) return;
    const auto& coord = config["coordinator"];
    if (coord.contains("modes") && coord["modes"].is_object())
        state.modes_config = coord["modes"];
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

} // namespace setup_wire
