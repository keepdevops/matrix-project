#pragma once
// Inline validators for individual mode and preset entries.
// Included only by coordinator_config_validate.cpp.

#include "coordinator_config_validate.h"
#include "../modes/mode.h"
#include <iostream>

namespace coordinator_config { namespace impl {

inline void warn(const std::string& msg) {
    std::cerr << "[config] " << msg << std::endl;
}

inline bool mode_registered(const std::string& name) {
    return modes::get(name) != nullptr;
}

inline void validate_string_option(const std::string& mode_name,
                                   const json& cfg,
                                   const char* key) {
    if (!cfg.contains(key)) return;
    if (!cfg[key].is_string())
        warn("coordinator.modes[\"" + mode_name + "\"]." + key + " must be a string");
}

inline void validate_mode_entry(const std::string& mode_name, const json& cfg,
                                ValidationResult& r, bool strict_modes) {
    if (!cfg.is_object()) {
        warn("coordinator.modes[\"" + mode_name + "\"] must be an object");
        r.ok = false;
        return;
    }
    if (strict_modes && !mode_registered(mode_name))
        warn("unknown mode key under coordinator.modes (not registered): \"" + mode_name + "\"");

    if (cfg.contains("agents")) {
        if (!cfg["agents"].is_array()) {
            warn("coordinator.modes[\"" + mode_name + "\"].agents must be an array");
            r.ok = false;
        } else {
            for (const auto& x : cfg["agents"]) {
                if (!x.is_string()) {
                    warn("coordinator.modes[\"" + mode_name + "\"].agents entries must be strings");
                    r.ok = false; break;
                }
            }
        }
    }
    if (cfg.contains("order")) {
        if (!cfg["order"].is_array()) {
            warn("coordinator.modes[\"" + mode_name + "\"].order must be an array");
            r.ok = false;
        } else {
            for (const auto& x : cfg["order"]) {
                if (!x.is_string()) {
                    warn("coordinator.modes[\"" + mode_name + "\"].order entries must be strings");
                    r.ok = false; break;
                }
            }
        }
    }
    if (cfg.contains("max_select")) {
        if (!cfg["max_select"].is_number_integer()) {
            warn("coordinator.modes[\"" + mode_name + "\"].max_select must be an integer");
            r.ok = false;
        } else if (cfg["max_select"].get<int>() < 1) {
            warn("coordinator.modes[\"" + mode_name + "\"].max_select must be >= 1");
            r.ok = false;
        }
    }
    if (cfg.contains("synthesizer") && !cfg["synthesizer"].is_string()) {
        warn("coordinator.modes[\"" + mode_name + "\"].synthesizer must be a string");
        r.ok = false;
    }
    if (cfg.contains("stage_context_chars")) {
        if (!cfg["stage_context_chars"].is_number_integer()) {
            warn("coordinator.modes[\"" + mode_name + "\"].stage_context_chars must be an integer");
            r.ok = false;
        } else if (cfg["stage_context_chars"].get<int>() < 0) {
            warn("coordinator.modes[\"" + mode_name + "\"].stage_context_chars must be >= 0");
            r.ok = false;
        }
    }
    for (const char* key : {"variant_policy", "preset", "synthesis_policy", "classifier_policy"})
        validate_string_option(mode_name, cfg, key);
}

}} // namespace coordinator_config::impl

#include "coordinator_config_validate_presets.h"
