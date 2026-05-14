#pragma once

#include "../json.hpp"
#include <string>

namespace coordinator_config {

// If `path` is a directory, aggregate <path>/agents/*.json into an `agents`
// array, then merge in <path>/coordinator.json (which provides the
// `coordinator` and optional `ui` blocks). The returned document is
// schema-equivalent to the legacy monolithic swarm-config.json.
//
// Returns true on success; on failure writes a diagnostic to std::cerr.
bool load_swarm_config_from_dir(const std::string& path, nlohmann::json& out);

// True iff `path` looks like a directory (regular existence check; does
// not validate contents).
bool is_directory_path(const std::string& path);

}  // namespace coordinator_config
