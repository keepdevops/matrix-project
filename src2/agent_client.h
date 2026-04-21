#pragma once

#include "agent.h"
#include <string>
#include <vector>

// Thread-safe HTTP caller for a single agent. Handles engine-specific quirks
// (mlx serialization + drain delay, docker/vllm model injection, system-prompt
// merging for mlx). Errors are logged to std::cerr and returned as a
// human-readable string in the result — never silent.
std::string call_agent(const Agent& agent, const std::string& prompt);

// Install one per-port mutex for each mlx agent so concurrent requests to the
// same mlx-lm port are serialized. Call once at startup, after agents are
// loaded from config.
void init_mlx_port_locks(const std::vector<Agent>& agents);
