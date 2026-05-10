#include "coordinator_config_validate.h"

#include "../modes/mode.h"

#include <iostream>

namespace coordinator_config {

namespace {

void warn(const std::string& msg) {
    std::cerr << "[config] " << msg << std::endl;
}

bool mode_registered(const std::string& name) {
    return modes::get(name) != nullptr;
}

void validate_string_option(const std::string& mode_name,
                            const json& cfg,
                            const char* key) {
    if (!cfg.contains(key)) return;
    if (!cfg[key].is_string())
        warn("coordinator.modes[\"" + mode_name + "\"]." + key + " must be a string");
}

void validate_mode_entry(const std::string& mode_name, const json& cfg, ValidationResult& r,
                           bool strict_modes) {
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
                    r.ok = false;
                    break;
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
                    r.ok = false;
                    break;
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
    for (const char* key : {"variant_policy", "preset", "synthesis_policy", "classifier_policy"}) {
        validate_string_option(mode_name, cfg, key);
    }
}

void validate_preset_entry(const std::string& preset_name, const json& p, ValidationResult& r) {
    if (!p.is_object()) {
        warn("coordinator.presets[\"" + preset_name + "\"] must be an object");
        r.ok = false;
        return;
    }
    if (p.contains("mode") && !p["mode"].is_string()) {
        warn("coordinator.presets[\"" + preset_name + "\"].mode must be a string");
        r.ok = false;
    }
    if (p.contains("agents")) {
        if (!p["agents"].is_array()) {
            warn("coordinator.presets[\"" + preset_name + "\"].agents must be an array");
            r.ok = false;
        } else {
            for (const auto& x : p["agents"]) {
                if (!x.is_string()) {
                    warn("coordinator.presets[\"" + preset_name + "\"].agents entries must be strings");
                    r.ok = false;
                    break;
                }
            }
        }
    }
    if (p.contains("synthesizer") && !p["synthesizer"].is_string()) {
        warn("coordinator.presets[\"" + preset_name + "\"].synthesizer must be a string");
        r.ok = false;
    }
    if (p.contains("max_select")) {
        if (!p["max_select"].is_number_integer()) {
            warn("coordinator.presets[\"" + preset_name + "\"].max_select must be an integer");
            r.ok = false;
        } else if (p["max_select"].get<int>() < 1) {
            warn("coordinator.presets[\"" + preset_name + "\"].max_select must be >= 1");
            r.ok = false;
        }
    }
}

}  // namespace

ValidationResult validate_modes_object(const json& modes) {
    ValidationResult r;
    if (!modes.is_object()) {
        warn("coordinator.modes must be a JSON object");
        r.ok = false;
        return r;
    }
    for (auto it = modes.begin(); it != modes.end(); ++it) {
        validate_mode_entry(it.key(), it.value(), r, true);
    }
    return r;
}

ValidationResult validate_presets_object(const json& presets) {
    ValidationResult r;
    if (!presets.is_object()) {
        warn("coordinator.presets must be a JSON object");
        r.ok = false;
        return r;
    }
    for (auto it = presets.begin(); it != presets.end(); ++it) {
        validate_preset_entry(it.key(), it.value(), r);
    }
    return r;
}

void validate_and_log_coordinator_block(const json& coordinator) {
    if (!coordinator.is_object()) {
        warn("coordinator block must be a JSON object");
        return;
    }
    if (coordinator.contains("modes"))
        validate_modes_object(coordinator["modes"]);
    if (coordinator.contains("presets"))
        validate_presets_object(coordinator["presets"]);
    if (coordinator.contains("default_mode") && !coordinator["default_mode"].is_string())
        warn("coordinator.default_mode must be a string");
}

ValidationResult validate_swarm_config_document(const json& doc, bool strict_modes) {
    ValidationResult r;
    if (!doc.is_object()) {
        warn("swarm config root must be a JSON object");
        r.ok = false;
        return r;
    }
    if (!doc.contains("agents") || !doc["agents"].is_array()) {
        warn("top-level \"agents\" must be present and an array");
        r.ok = false;
        return r;
    }
    for (const auto& a : doc["agents"]) {
        if (!a.is_object()) {
            warn("each agents[] entry must be an object");
            r.ok = false;
            break;
        }
        if (!a.contains("name") || !a["name"].is_string()) {
            warn("each agent must have a string \"name\"");
            r.ok = false;
        }
    }
    if (!doc.contains("coordinator")) return r;

    const json& c = doc["coordinator"];
    if (!c.is_object()) {
        warn("coordinator block must be an object");
        r.ok = false;
        return r;
    }
    if (c.contains("modes")) {
        if (!c["modes"].is_object()) {
            warn("coordinator.modes must be an object");
            r.ok = false;
        } else {
            for (auto it = c["modes"].begin(); it != c["modes"].end(); ++it)
                validate_mode_entry(it.key(), it.value(), r, strict_modes);
        }
    }
    if (c.contains("presets")) {
        ValidationResult pr = validate_presets_object(c["presets"]);
        if (!pr.ok) r.ok = false;
    }
    if (c.contains("default_mode") && !c["default_mode"].is_string()) {
        warn("coordinator.default_mode must be a string");
        r.ok = false;
    }
    return r;
}

}  // namespace coordinator_config
