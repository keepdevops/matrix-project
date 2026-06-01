#pragma once

#include "../json.hpp"

namespace coordinator_config {

using json = nlohmann::json;

struct ValidationResult;

void warn(const std::string& msg);
bool mode_registered(const std::string& name);
void validate_string_option(const std::string& mode_name, const json& cfg, const char* key);

}  // namespace coordinator_config
