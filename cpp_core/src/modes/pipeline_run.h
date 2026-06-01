#pragma once

#include "mode.h"
#include "../json.hpp"

namespace modes {

nlohmann::json run_pipeline_mode(const ModeContext& ctx);

}  // namespace modes
