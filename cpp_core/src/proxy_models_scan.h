#pragma once

#include "json.hpp"

using json = nlohmann::json;

/// Scan MATRIX_MODEL_DIR (via global matrix env). No httplib.
json proxy_scan_models_from_env();

void proxy_append_docker_models(json& result);
