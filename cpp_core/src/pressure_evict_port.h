#pragma once

#include "json.hpp"

namespace pressure_evict {

nlohmann::json evict_port(int port, double threshold, long min_kv_tokens, bool force,
                          bool dry_run);

}  // namespace pressure_evict
