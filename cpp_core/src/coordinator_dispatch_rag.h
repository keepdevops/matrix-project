#pragma once

#include "json.hpp"

#include <string>
#include <unordered_set>

struct RagDispatchPrep {
    std::string effective_prompt;
    std::string rag_block_for_ctx;
    nlohmann::json rag_meta = nlohmann::json::object();
};

RagDispatchPrep prepare_rag_for_dispatch(
    const nlohmann::json& body,
    const std::string& user_prompt,
    const std::string& effective_prompt,
    const nlohmann::json& startup_config);
