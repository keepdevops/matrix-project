#pragma once

#include "../agent.h"
#include "../json.hpp"
#include "mode.h"

#include <string>
#include <unordered_map>
#include <vector>

namespace pipeline_order {

struct ResolvedOrder {
    std::vector<std::string> order;
    bool fallback_order_used = false;
    nlohmann::json substitutions = nlohmann::json::object();
};

ResolvedOrder resolve_effective_order(const ModeContext& ctx,
                                    const std::string& synth_name_for_filter);

}  // namespace pipeline_order
