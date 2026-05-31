#pragma once

#include "coordinator_context.h"
#include "httplib.h"
#include "json.hpp"

void register_coordinator_routes_cache(httplib::Server& svr, CoordinatorState& st);
void apply_startup_response_cache_config(const nlohmann::json& startup_config);
