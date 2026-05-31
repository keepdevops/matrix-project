#pragma once

#include "json.hpp"

using json = nlohmann::json;

/** Live host unified-memory snapshot (macOS). Returns ok:false when unavailable. */
json host_memory_snapshot();
