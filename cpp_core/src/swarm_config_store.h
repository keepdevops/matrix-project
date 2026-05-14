#pragma once
// Persistence / JSON helpers only — do not include httplib here (HTTP binds in coordinator_routes_*).

#include "json.hpp"
#include <mutex>
#include <string>

using json = nlohmann::json;

/// Active config path plus optional project mirror (MATRIX_SOURCE_CONFIG).
struct SwarmPaths {
    std::string active_config_path;
    std::string source_config_path;
};

bool read_swarm_config_doc(const std::string& path, json& doc);

bool agent_name_in_persisted_roster(const SwarmPaths& paths, const std::string& name);

struct DualWriteOutcome {
    bool active_ok = false;
    bool source_ok = false;
};

DualWriteOutcome persist_agent_system_prompt(const SwarmPaths& paths,
    const std::string& name, const std::string& system_prompt);

DualWriteOutcome persist_agent_description(const SwarmPaths& paths,
    const std::string& name, const std::string& description);

struct TokenPersistParams {
    bool has_max = false;
    int max_tokens = 0;
    bool has_ctx = false;
    int context = 0;
    bool apply_read_timeout = false;
    int read_timeout_secs = 0;
};

DualWriteOutcome persist_agent_tokens(const SwarmPaths& paths,
    const std::string& name, const TokenPersistParams& params);

/// Merge coordinator.modes + coordinator.presets into one JSON file; preserves other keys.
bool swarm_write_modes_presets_to_file(const std::string& path,
    const json& modes_config,
    std::mutex& presets_mutex,
    json& presets);

/// Active file plus optional mirror (same logic as legacy persist_modes_config_locked body).
bool swarm_mirror_modes_presets(const SwarmPaths& paths,
    const json& modes_config,
    std::mutex& presets_mutex,
    json& presets);
