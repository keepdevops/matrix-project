#pragma once
#include "coordinator_context.h"
#include "json.hpp"
#include <string>

// Load swarm config JSON from path, config service, or directory.
// Returns false and prints to stderr on failure.
bool coordinator_load_config(const std::string& config_path, nlohmann::json& config);

// Set state file paths based on config path type.
void coordinator_set_state_paths(CoordinatorState& state, const std::string& config_path);

// Wire agents from config into state.agents.
void coordinator_wire_agents(CoordinatorState& state, const nlohmann::json& config);

// Apply coordinator section (modes_config, presets, default_mode).
void coordinator_apply_coordinator_section(CoordinatorState& state, const nlohmann::json& config);
