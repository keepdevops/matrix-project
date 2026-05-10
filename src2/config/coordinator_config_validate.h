#pragma once

// Validates coordinator.* blocks from swarm-config.json after parse.
// Logging only — does not mutate JSON (caller loads state as today).

#include "../json.hpp"

namespace coordinator_config {

using json = nlohmann::json;

struct ValidationResult {
    bool ok = true;
};

/// Each top-level key under coordinator.modes must match a registered Mode name.
ValidationResult validate_modes_object(const json& modes);

/// Each preset entry should be an object with optional mode, agents[], synthesizer, max_select.
ValidationResult validate_presets_object(const json& presets);

/// Validates coordinator block (modes, presets, default_mode types).
void validate_and_log_coordinator_block(const json& coordinator);

/// Validates full swarm-config.json shape (agents array + optional coordinator block).
/// When `strict_modes` is false, skips checks that require `modes::get` (for standalone tools).
ValidationResult validate_swarm_config_document(const json& doc, bool strict_modes);

}  // namespace coordinator_config
