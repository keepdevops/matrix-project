#include "coordinator_config_validate_common.h"
#include "coordinator_config_validate_internal.h"
#include "coordinator_config_validate.h"

namespace coordinator_config {

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

}  // namespace coordinator_config
