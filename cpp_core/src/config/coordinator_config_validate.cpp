#include "coordinator_config_validate.h"
#include "coordinator_config_validate_entries.h"

namespace coordinator_config {

using impl::warn;
using impl::validate_mode_entry;
using impl::validate_preset_entry;

ValidationResult validate_modes_object(const json& modes) {
    ValidationResult r;
    if (!modes.is_object()) {
        warn("coordinator.modes must be a JSON object");
        r.ok = false;
        return r;
    }
    for (auto it = modes.begin(); it != modes.end(); ++it)
        validate_mode_entry(it.key(), it.value(), r, true);
    return r;
}

ValidationResult validate_presets_object(const json& presets) {
    ValidationResult r;
    if (!presets.is_object()) {
        warn("coordinator.presets must be a JSON object");
        r.ok = false;
        return r;
    }
    for (auto it = presets.begin(); it != presets.end(); ++it)
        validate_preset_entry(it.key(), it.value(), r);
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
