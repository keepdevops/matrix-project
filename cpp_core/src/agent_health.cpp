#include "agent_health.h"

#include <chrono>
#include <deque>
#include <iostream>
#include <map>
#include <mutex>

using json = nlohmann::json;

namespace agent_health {

namespace {

constexpr long WINDOW_MS   = 60'000;
constexpr int  THRESHOLD   = 3;
constexpr long COOLDOWN_MS = 30'000;

struct Entry {
    std::deque<long> failure_ts; // monotonic ms timestamps
    bool tripped = false;
    long cooldown_until_ms = 0;
};

std::map<std::string, Entry> g_state;
std::mutex g_mu;

long now_ms() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::steady_clock::now().time_since_epoch()).count();
}

void prune_window(Entry& e, long now) {
    while (!e.failure_ts.empty() && (now - e.failure_ts.front()) > WINDOW_MS) {
        e.failure_ts.pop_front();
    }
}

} // namespace

void record(const std::string& name, bool success) {
    if (name.empty()) return;
    std::lock_guard<std::mutex> lk(g_mu);
    Entry& e = g_state[name];
    long now = now_ms();
    prune_window(e, now);

    if (success) {
        if (e.tripped) {
            std::cerr << "🟢 [health] " << name
                      << " breaker reset (success after cooldown)" << std::endl;
        }
        e.failure_ts.clear();
        e.tripped = false;
        e.cooldown_until_ms = 0;
        return;
    }

    e.failure_ts.push_back(now);
    if (e.tripped) {
        // Re-tripped during half-open: extend cooldown rather than ratchet
        // the failure count forever.
        e.cooldown_until_ms = now + COOLDOWN_MS;
        std::cerr << "🔴 [health] " << name
                  << " breaker re-tripped during half-open; cooldown extended"
                  << std::endl;
    } else if ((int)e.failure_ts.size() >= THRESHOLD) {
        e.tripped = true;
        e.cooldown_until_ms = now + COOLDOWN_MS;
        std::cerr << "🔴 [health] " << name << " breaker TRIPPED ("
                  << e.failure_ts.size() << " failures in last "
                  << (WINDOW_MS / 1000) << "s); cooldown "
                  << (COOLDOWN_MS / 1000) << "s" << std::endl;
    }
}

bool is_open(const std::string& name) {
    std::lock_guard<std::mutex> lk(g_mu);
    auto it = g_state.find(name);
    if (it == g_state.end() || !it->second.tripped) return false;
    long now = now_ms();
    // Half-open once cooldown elapses — let the dispatcher re-probe.
    return now < it->second.cooldown_until_ms;
}

json snapshot() {
    std::lock_guard<std::mutex> lk(g_mu);
    json out = json::object();
    long now = now_ms();
    for (auto& kv : g_state) {
        Entry& e = kv.second;
        prune_window(e, now);
        long cooldown_remaining = 0;
        if (e.tripped) {
            cooldown_remaining = e.cooldown_until_ms > now
                ? (e.cooldown_until_ms - now) : 0;
        }
        out[kv.first] = {
            {"recent_failures", (int)e.failure_ts.size()},
            {"tripped", e.tripped && now < e.cooldown_until_ms},
            {"cooldown_remaining_ms", cooldown_remaining},
        };
    }
    out["__config"] = {
        {"window_ms", WINDOW_MS},
        {"threshold", THRESHOLD},
        {"cooldown_ms", COOLDOWN_MS},
    };
    return out;
}

} // namespace agent_health
