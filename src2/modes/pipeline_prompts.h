#pragma once
// Pure prompt strings for pipeline / SSE (no httplib).

#include <string>

/// Staged user message for pipeline step N>1 (no HTTP / httplib).
std::string build_pipeline_staged_user_prompt(const std::string& user_prompt,
    const std::string& prev_agent,
    const std::string& prev_output);
