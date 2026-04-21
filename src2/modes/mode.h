#pragma once

#include "../agent.h"
#include "../json.hpp"

#include <functional>
#include <string>
#include <vector>

struct ModeContext {
    const std::vector<Agent>& agents;
    const std::string& user_prompt;
    double temperature;
    const nlohmann::json& mode_config; // per-mode options from swarm-config.json
};

// A mode returns an envelope: {mode, agents, final, meta}.
// - agents: {name: text, ...} per-agent outputs
// - final: combined text when the mode produces one, else null
// - meta: mode-specific details (rounds, ordering, errors, etc.)
using ModeFn = std::function<nlohmann::json(const ModeContext&)>;

struct Mode {
    std::string name;        // "flat", "scatter-gather", ...
    std::string description; // one-line, shown in UI
    ModeFn run;
};

namespace modes {

// Register a mode. Safe to call from static initializers before main().
void register_mode(const Mode& m);

// Lookup. Returns nullptr if name is unknown.
const Mode* get(const std::string& name);

// Snapshot of all registered modes, in registration order.
std::vector<Mode> list();

// Set the active mode. Returns false if name is not registered.
bool set_active(const std::string& name);

// Name of the active mode (defaults to first registered mode if none set).
std::string active();

} // namespace modes
