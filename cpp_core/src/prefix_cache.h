#pragma once
// KVFlow-style shared prefix tracker.
// Records prompt prefixes per port; boosts KV importance for cache-warm ports.

#include "json.hpp"
#include <algorithm>
#include <chrono>
#include <map>
#include <mutex>
#include <string>
#include <vector>

namespace prefix_cache {

struct Entry {
    std::string prefix;
    int         port        = 0;
    int         hit_count   = 0;
    long long   last_seen_ms = 0;
};

namespace detail {
inline std::map<int, Entry>& store() { static std::map<int, Entry> s; return s; }
inline std::mutex& mu() { static std::mutex m; return m; }
} // namespace detail

/// Record a prompt use for a port. prefix_len chars of the prompt are stored.
inline void record(int port, const std::string& prompt, int prefix_len = 512) {
    long long now = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::steady_clock::now().time_since_epoch()).count();
    std::string prefix = prompt.substr(0, std::min((int)prompt.size(), prefix_len));
    std::lock_guard<std::mutex> lk(detail::mu());
    auto& e = detail::store()[port];
    if (e.prefix == prefix) {
        ++e.hit_count;
    } else {
        e.prefix    = prefix;
        e.hit_count = 1;
    }
    e.port         = port;
    e.last_seen_ms = now;
}

/// Returns all entries sorted by hit_count descending.
inline std::vector<Entry> ranked() {
    std::lock_guard<std::mutex> lk(detail::mu());
    std::vector<Entry> v;
    for (const auto& [p, e] : detail::store()) v.push_back(e);
    std::sort(v.begin(), v.end(),
              [](const Entry& a, const Entry& b) { return a.hit_count > b.hit_count; });
    return v;
}

/// Importance boost 0–0.3 based on hit count (more reuse = more important to keep).
inline double prefix_importance_boost(int port) {
    std::lock_guard<std::mutex> lk(detail::mu());
    auto it = detail::store().find(port);
    if (it == detail::store().end()) return 0.0;
    return std::min(0.3, it->second.hit_count * 0.05);
}

inline nlohmann::json snapshot() {
    auto v = ranked();
    auto arr = nlohmann::json::array();
    for (const auto& e : v)
        arr.push_back({{"port", e.port}, {"hit_count", e.hit_count},
                       {"prefix_len", (int)e.prefix.size()}});
    return arr;
}

} // namespace prefix_cache
