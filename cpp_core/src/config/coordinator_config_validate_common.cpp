#include "coordinator_config_validate_common.h"
#include "coordinator_config_validate.h"

#include "../modes/mode.h"

#include <iostream>

namespace coordinator_config {

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

}  // namespace coordinator_config
