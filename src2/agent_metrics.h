#pragma once

#include "json.hpp"
#include <string>

// Per-dispatch agent metrics: wall-clock duration + token counts.
//
// Lifecycle:
//   reset()   — called by the dispatcher before invoking a mode.
//   record()  — called by call_agent / agent_stream after each successful call.
//   snapshot()— called by the dispatcher after the mode returns; surfaces in
//               envelope.meta.timings.
//
// MVP simplification: the registry is process-global (mutex-guarded), not
// per-dispatch-scope. Concurrent dispatches will interleave entries — fine in
// practice because each dispatch resets before running. If contention becomes
// real, add a context handle.
namespace agent_metrics {

void reset();
void record(const std::string& agent_name, double duration_ms,
            long completion_tokens, long prompt_tokens = -1);
nlohmann::json snapshot();

} // namespace agent_metrics
