#pragma once

#include "../agent.h"
#include "../json.hpp"

#include <vector>

namespace router_endpoint {

/// TTL-cached HTTP probe for agent port liveness.
bool endpoint_ready(const Agent& a);

/// Parallel port checks; returns reachable agents and fills excluded names.
std::vector<Agent> filter_reachable(const std::vector<Agent>& agents,
                                      nlohmann::json& excluded_unreachable);

}  // namespace router_endpoint
