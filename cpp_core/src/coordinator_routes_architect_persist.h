#pragma once
#include "coordinator_routes_includes.h"
#include "coordinator_routes_architect_synthesis.h"
#include <map>
#include <string>

/** Persist a streaming run to history + sessions and emit the session SSE event. */
void persist_stream_run(
    const std::string& user_prompt,
    double temperature,
    const std::string& mode,
    const std::string& session_id,
    const std::string& run_id,
    const std::string& parent_run_id,
    const std::map<std::string, std::string>& outputs,
    CoordinatorState& st,
    const WriteEventFn& write_event);
