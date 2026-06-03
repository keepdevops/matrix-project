#pragma once
#include <string>

namespace swarm_config_resolve {

// Resolve readable config path: primary → swarm-config.json → template.
// Sets resolved_path and returns true when a file was opened.
bool open_config_path(const std::string& requested, std::string& resolved_path);

}  // namespace swarm_config_resolve
