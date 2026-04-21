#pragma once

#include "agent.h"
#include <string>
#include <vector>

// Thread-safe HTTP caller for a single agent. Handles engine-specific quirks
// (mlx serialization + drain delay, docker/vllm model injection, system-prompt
// merging for mlx). Errors are logged to std::cerr and returned as a
// human-readable string in the result — never silent.
std::string call_agent(const Agent& agent, const std::string& prompt);

// Same as call_agent, but replaces the agent's configured system_prompt for
// this one call. Useful for classifier/router invocations where the agent's
// role prompt would fight the structured output we need.
std::string call_agent_with_system(const Agent& agent,
                                   const std::string& system_prompt_override,
                                   const std::string& prompt);

// Install one per-port mutex for each mlx agent so concurrent requests to the
// same mlx-lm port are serialized. Call once at startup, after agents are
// loaded from config.
void init_mlx_port_locks(const std::vector<Agent>& agents);
