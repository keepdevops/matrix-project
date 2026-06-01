#pragma once
// Session-scoped token ledger. Tracks cumulative token consumption per
// session and enforces an optional budget cap.
// Process-global, mutex-guarded — same pattern as agent_health.

#include "json.hpp"
#include <string>

namespace token_ledger {

struct Entry {
    int budget   = 0;   // 0 = unlimited
    int consumed = 0;

    int  remaining() const { return budget > 0 ? std::max(0, budget - consumed) : -1; }
    bool overrun()   const { return budget > 0 && consumed >= budget; }
};

/// Set (or reset) the budget for a session. Call before first add().
void set_budget(const std::string& session_id, int budget);

/// Record tokens consumed by one agent call. prompt_toks or completion_toks
/// may be -1 if the backend did not report them; only positive values counted.
void add(const std::string& session_id, long prompt_toks, long completion_toks);

/// Read the current ledger entry (returns zero Entry if session unknown).
Entry get(const std::string& session_id);

/// Remove a session entry (call on session clear).
void reset(const std::string& session_id);

/// JSON snapshot: {session_id, budget, consumed, remaining, overrun}.
nlohmann::json snapshot(const std::string& session_id);

/// Sum of consumed tokens across all active sessions (for Prometheus export).
int session_total_consumed();

/// All sessions as a JSON array (for Prometheus endpoint).
nlohmann::json all_sessions_snapshot();

} // namespace token_ledger
