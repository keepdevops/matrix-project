#pragma once

#include "agent.h"
#include "json.hpp"
#include "swarm_config_store.h"

#include <mutex>
#include <string>
#include <vector>

using json = nlohmann::json;

/// Owns coordinator process state previously scattered as statics in coordinator.cpp.
struct CoordinatorState {
    std::vector<Agent> agents;
    std::vector<json> history;
    std::mutex history_mutex;
    std::string history_path;

    json modes_config = json::object();
    std::mutex modes_config_mutex;

    json presets = json::object();
    std::mutex presets_mutex;

    std::string config_path_global;
    std::string source_config_path_global;

    /// Root JSON loaded at startup (used for optional response-cache block).
    json startup_config;

    SwarmPaths swarm_paths() const {
        return SwarmPaths{config_path_global, source_config_path_global};
    }
};

void coordinator_load_history(CoordinatorState& st);
void coordinator_save_history(CoordinatorState& st);

/// Caller must hold `st.modes_config_mutex` (same contract as legacy persist).
bool coordinator_persist_modes_locked(CoordinatorState& st);
