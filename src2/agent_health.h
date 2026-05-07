#pragma once

#include "json.hpp"
#include <string>

// Per-agent circuit breaker. Tracks recent failures in a sliding window;
// once a threshold is crossed, the agent is "open" and dispatchers should
// skip it until a cooldown elapses. After cooldown the breaker is half-open:
// the next call is attempted. Success closes the breaker, failure re-opens
// it with a fresh cooldown.
//
// Thresholds are compile-time constants. Tunable later via config; current
// values err on the side of leniency for cold-start latency:
//   WINDOW_MS  = 60_000  (one-minute sliding window)
//   THRESHOLD  = 3       (3 failures within the window trip the breaker)
//   COOLDOWN_MS= 30_000  (skip-window after tripping)
namespace agent_health {

// Record the outcome of a single call_agent invocation. Idempotent + thread-safe.
void record(const std::string& agent_name, bool success);

// True when the breaker is open AND the cooldown has not elapsed.
// Returns false during the half-open window so the next dispatcher call
// re-probes the agent and can close the breaker on success.
bool is_open(const std::string& agent_name);

// Snapshot of all known agents' health for diagnostic / UI surfacing.
// Shape: { agent_name: { recent_failures, tripped, cooldown_remaining_ms } }
nlohmann::json snapshot();

} // namespace agent_health
