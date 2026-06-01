#pragma once

#include "session_store.h"

#include "json.hpp"

SessionContinuation session_build_continuation_impl(
    const nlohmann::json& sessions,
    const std::string& session_id,
    const std::string& followup,
    const nlohmann::json& context_policy);
