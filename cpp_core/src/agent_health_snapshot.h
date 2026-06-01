#pragma once
// Internal circuit-breaker state — included only by agent_health.cpp.

#include <chrono>
#include <deque>
#include <map>
#include <mutex>
#include <string>

namespace agent_health {

constexpr long WINDOW_MS   = 60'000;
constexpr int  THRESHOLD   = 3;
constexpr long COOLDOWN_MS = 30'000;

struct Entry {
    std::deque<long> failure_ts;
    bool tripped = false;
    long cooldown_until_ms = 0;
};

static std::map<std::string, Entry> g_state;
static std::mutex g_mu;

inline long now_ms() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::steady_clock::now().time_since_epoch()).count();
}

inline void prune_window(Entry& e, long now) {
    while (!e.failure_ts.empty() && (now - e.failure_ts.front()) > WINDOW_MS)
        e.failure_ts.pop_front();
}

} // namespace agent_health
