#pragma once

#include "coordinator_config_validate.h"

namespace coordinator_config {

void validate_mode_entry(const std::string& mode_name, const json& cfg, ValidationResult& r,
                         bool strict_modes);
void validate_preset_entry(const std::string& preset_name, const json& p, ValidationResult& r);

}  // namespace coordinator_config
